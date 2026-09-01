[CmdletBinding()]
param(
    [string]$TaskName = "DeepSeek Harness Web",
    [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }),
    [switch]$SkipCopilotBridge,
    [switch]$RemoveElevatedTask
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = $PSScriptRoot
if (-not $projectRoot) {
    throw "Unable to determine the project directory."
}

function Resolve-PowerShell7 {
    $command = Get-Command pwsh -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "PowerShell 7 is required. Install it from https://aka.ms/powershell-release?tag=stable."
    }
    return $command.Source
}

function Test-IsAdministrator {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole(
        [System.Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Resolve-Pnpm {
    $wingetPackages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    $wingetPackage = Get-ChildItem `
        -LiteralPath $wingetPackages `
        -Directory `
        -Filter "pnpm.pnpm_*" `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($wingetPackage) {
        $wingetExecutable = Join-Path $wingetPackage.FullName "pnpm.exe"
        if (Test-Path -LiteralPath $wingetExecutable) {
            return $wingetExecutable
        }
    }
    $wingetLink = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\pnpm.exe"
    if (Test-Path -LiteralPath $wingetLink) {
        return $wingetLink
    }
    $command = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    throw "pnpm installation completed but pnpm was not found."
}

function Resolve-Node {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Node.js ^22.19 or >=24 is required."
    }
    $version = [version](& $command.Source -p "process.versions.node")
    $supported = (
        ($version.Major -eq 22 -and $version.Minor -ge 19) `
        -or $version.Major -ge 24
    )
    if (-not $supported) {
        throw "Node.js $version is unsupported; install Node.js ^22.19 or >=24."
    }
    return $command.Source
}

function Stop-DshWebListener {
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $connection = Get-NetTCPConnection `
            -LocalAddress "127.0.0.1" `
            -LocalPort 3080 `
            -State Listen `
            -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if (-not $connection) {
            return
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)

    $process = Get-CimInstance `
        Win32_Process `
        -Filter "ProcessId=$($connection.OwningProcess)"
    if (
        $process.CommandLine -notmatch "apps[\\/]cli[\\/]src[\\/]bin\.ts.*--no-open" `
        -and $process.CommandLine -notmatch "scripts[\\/]run-windows-web\.ts"
    ) {
        throw "Port 3080 is owned by an unrelated process (PID $($process.ProcessId))."
    }
    Stop-Process -Id $process.ProcessId
    Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
}

$pwsh = Resolve-PowerShell7
if ($PSVersionTable.PSVersion.Major -lt 7) {
    $arguments = @(
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $PSCommandPath,
        "-TaskName", $TaskName,
        "-DshHome", $DshHome
    )
    if ($SkipCopilotBridge) {
        $arguments += "-SkipCopilotBridge"
    }
    if ($RemoveElevatedTask) {
        $arguments += "-RemoveElevatedTask"
    }
    & $pwsh @arguments
    exit $LASTEXITCODE
}

$isAdministrator = Test-IsAdministrator
if ($RemoveElevatedTask) {
    if (-not $isAdministrator) {
        throw "-RemoveElevatedTask requires administrator privileges."
    }
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    exit 0
}

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (
    $existingTask `
    -and $existingTask.Principal.RunLevel -eq "Highest" `
    -and -not $isAdministrator
) {
    Write-Host "Requesting one-time elevation to migrate the existing task to limited privileges..."
    $arguments = @(
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$PSCommandPath`"",
        "-TaskName", "`"$TaskName`"",
        "-RemoveElevatedTask"
    )
    $process = Start-Process `
        -FilePath $pwsh `
        -ArgumentList $arguments `
        -Verb RunAs `
        -Wait `
        -PassThru
    if ($process.ExitCode -ne 0) {
        throw "The elevated legacy-task removal failed with exit code $($process.ExitCode)."
    }
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
    throw "winget is required to install or update pnpm."
}

Write-Host "Installing or updating pnpm through winget..."
& $winget.Source install -e --id pnpm.pnpm `
    --accept-package-agreements --accept-source-agreements --disable-interactivity
$wingetExitCode = [int64]$LASTEXITCODE -band 0xffffffffL
$updateNotApplicable = 0x8A15002BL
if ($wingetExitCode -notin @(0, $updateNotApplicable)) {
    throw "winget could not install or update pnpm (exit $LASTEXITCODE)."
}
Refresh-Path
$node = Resolve-Node
$pnpm = Resolve-Pnpm
$pnpmVersionText = & $pnpm with current --version
if ($LASTEXITCODE -ne 0) {
    throw "Unable to query the installed pnpm version (exit $LASTEXITCODE)."
}
$pnpmVersion = $null
if (-not [version]::TryParse($pnpmVersionText.Trim(), [ref]$pnpmVersion)) {
    throw "pnpm returned an invalid version: $pnpmVersionText"
}
if ($pnpmVersion.Major -ne 11 -or $pnpmVersion.Minor -lt 7) {
    throw "pnpm $pnpmVersion is unsupported; this checkout requires pnpm 11.7 or newer in major version 11."
}
Write-Host "Using pnpm: $pnpm ($pnpmVersion)"

Push-Location $projectRoot
try {
    Write-Host "Installing project dependencies..."
    & $pnpm with current install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm install failed with exit code $LASTEXITCODE."
    }

    Write-Host "Building DeepSeek Harness..."
    & $pnpm with current run build
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm run build failed with exit code $LASTEXITCODE."
    }

    if (-not $SkipCopilotBridge) {
        Write-Host "Synchronizing the local Copilot provider catalogs..."
        & $pnpm with current exec tsx scripts/configure-local-copilot-provider.ts `
            --dsh-home $DshHome
        if ($LASTEXITCODE -ne 0) {
            throw "The local Copilot provider bridge failed with exit code $LASTEXITCODE. Ensure the 'Copilot DSH Provider' task reports ready, or rerun with -SkipCopilotBridge."
        }
    }

    Write-Host "Registering Task Scheduler task '$TaskName'..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-DshWebListener
    $webRunner = Join-Path $projectRoot "scripts\run-windows-web.ts"
    $action = New-ScheduledTaskAction `
        -Execute $node `
        -Argument "--import tsx/esm `"$webRunner`" `"$DshHome`"" `
        -WorkingDirectory $projectRoot
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal `
        -UserId $identity `
        -LogonType Interactive `
        -RunLevel Limited

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description "Current-user host for the local DeepSeek Harness Web UI." `
        -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName

    $deadline = [DateTime]::UtcNow.AddSeconds(180)
    do {
        Start-Sleep -Milliseconds 500
        $task = Get-ScheduledTask -TaskName $TaskName
        try {
            $response = Invoke-WebRequest `
                -Uri "http://127.0.0.1:3080/" `
                -SkipHttpErrorCheck `
                -TimeoutSec 2
        } catch {
            $response = $null
        }
    } while (
        [DateTime]::UtcNow -lt $deadline `
        -and (
            $task.State -ne "Running" `
            -or $null -eq $response `
            -or $response.StatusCode -notin @(200, 401)
        )
    )

    if ($task.State -ne "Running") {
        throw "The scheduled task did not stay running. Port 3080 may already be in use."
    }
    if ($null -eq $response -or $response.StatusCode -notin @(200, 401)) {
        throw "DeepSeek Harness did not answer at http://127.0.0.1:3080/."
    }

    Write-Host "Setup complete. DeepSeek Harness is running at http://127.0.0.1:3080/."
} finally {
    Pop-Location
}
