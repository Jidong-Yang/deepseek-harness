# Agent Note: Windows source deployment runs as an idempotent scheduled task

Status: implemented

English | [中文](2026-09-01-windows-source-deployment-task.zh.md)

## Problem

A Windows source deployment otherwise depends on a terminal that manually ran dependency installation, the build, and `pnpm dsh web`. Closing that terminal stops the Web application, login does not restore it, and a separately configured local Copilot provider can drift from the Harness model routes. Authentication and provider lifecycle must remain outside the Harness process.

## Decision

The root `setup.ps1` is the explicit, idempotent Windows source-deployment entry point. It requires PowerShell 7, winget, and a supported Node.js version; installs or updates pnpm with `winget install -e --id pnpm.pnpm`; runs `pnpm install --frozen-lockfile`, `pnpm run clean`, and `pnpm run build`; and registers the current user's `DeepSeek Harness Web` Task Scheduler task. Cleaning removes build output and safe residue from deleted packages before the build can discover stale modules. The task starts at interactive logon, ignores duplicate starts, has no execution time limit, and restarts after failures; the [elevated task decision](2026-09-01-windows-source-deployment-elevated-task.md) owns its registration and execution privileges. Task Scheduler executes Node directly through `scripts/run-windows-web.ts`, which pins the selected Harness home and dispatches the same source entry and arguments as `pnpm dsh web --no-open`; keeping Node as the task process makes stop and restart own the serving process rather than only a package-manager parent.

The setup invokes `scripts/configure-local-copilot-provider.ts` unless `-SkipCopilotBridge` is present. The bridge requires the sibling provider's safe health endpoint to report `ready`, reads both live protocol-specific model catalogs, and atomically updates only `llm-pi-ai.providers.copilot-proxy` and `llm-pi-ai.providers.copilot-chat` in the Harness settings document. It preserves unrelated settings and comments, removes a route whose protocol catalog is empty, publishes one bounded Harness retry, and supplies only a non-secret placeholder through the scheduled process environment. GitHub OAuth and Copilot session credentials remain owned by the provider process described in the [local provider setup decision](2026-08-24-local-copilot-provider-setup.md).

## Alternatives considered

**Start at machine boot before user logon.** Rejected because the source deployment uses the current user's Harness home, credentials, browser authorization state, and visible diagnostics. Interactive logon matches those owners and the sibling provider task without storing a Windows password or inventing a service account.

**Install a Windows service.** Rejected because a service would add another executable and service-account lifecycle for a developer checkout. Task Scheduler already supplies logon start, restart policy, single-instance behavior, the user's interactive token, and process ownership.

**Build Copilot authentication into the Harness task.** Rejected because the local provider owns token storage, refresh, entitlement checks, and upstream recovery. The bridge contains endpoint and catalog configuration only.

**Place the Copilot routes in a shipped profile.** Rejected because the sibling checkout and undocumented inference API are machine-local deployment choices. Explicit setup may publish them into the selected Harness home; ordinary profiles remain provider-neutral.

## Consequences

One command converges the Windows checkout, bridge configuration, and long-running Web process, and the next interactive logon restores the application without opening a browser. Rerunning setup updates dependencies, rebuilds, resynchronizes catalogs, replaces the task definition, and starts the new process. A missing or unhealthy Copilot provider makes the default setup fail after the build instead of publishing stale or invented models; `-SkipCopilotBridge` keeps the Harness deployment independent. The task does not pull or rewrite either Git worktree, and source updates take effect only after setup rebuilds and restarts it.
