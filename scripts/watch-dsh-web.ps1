param(
  [string]$TaskName = 'DeepSeek Harness Web',
  [int]$Port = 3080,
  [string]$StatusPath = (Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\web-host-health.json')
)
$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName $TaskName
$listening = [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
$healthy = $task.State -eq 'Running' -and $listening
if (-not $healthy) { Start-ScheduledTask -TaskName $TaskName }
$directory = Split-Path $StatusPath -Parent
New-Item -ItemType Directory -Force $directory | Out-Null
[ordered]@{
  healthy = $healthy
  taskState = [string]$task.State
  portListening = $listening
  recoveryRequested = -not $healthy
  observedAt = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json | Set-Content -Encoding utf8 $StatusPath
if (-not $healthy) { exit 1 }
