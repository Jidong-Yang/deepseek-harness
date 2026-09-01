# Agent Note: Windows source deployment runs its Web task elevated

Status: implemented

English | [中文](2026-09-01-windows-source-deployment-elevated-task.zh.md)

## Problem

The persistent Windows source deployment exposes Harness shell, filesystem, and subprocess tools through its authenticated loopback Web application. A limited scheduled-task token prevents those tools from performing administrator-only development operations, while launching the whole setup from an elevated terminal would also grant package installation, dependency lifecycle scripts, and the build unnecessary administrator privileges.

## Decision

The root `setup.ps1` installs dependencies, builds the checkout, and synchronizes the local Copilot provider as the initiating user. Task registration is a separate internal phase launched through UAC. That phase requires an administrator token for the same Windows account that initiated setup, replaces the `DeepSeek Harness Web` task, and registers its interactive principal with `RunLevel Highest`. The elevated task is the only deployment mode; repeated setup runs cannot silently downgrade it.

The Web application continues to listen only on `127.0.0.1` and require its persisted launch token. These controls limit access but do not reduce the authority of an authenticated request: tools and approved model actions execute with the scheduled task's administrator privileges.

This decision partially supersedes only the task-token choice in the [Windows source deployment decision](2026-09-01-windows-source-deployment-task.md). Its logon trigger, restart policy, direct Node ownership, Harness-home selection, and provider bridge remain unchanged.

## Alternatives considered

**Keep limited privileges by default and add an elevation switch.** Rejected because the Windows source deployment is expected to perform administrator-only development operations. Two modes would make a routine setup rerun capable of silently changing the deployed tool authority.

**Run the complete setup elevated.** Rejected because dependency installation and build scripts do not require administrator rights. Elevating only task registration avoids granting those operations write access outside the user's normal authorization.

**Add a privileged broker inside the Harness runtime.** Rejected because this deployment needs the existing Windows process token, not a new product capability or authorization protocol. A broker would expand the runtime and security model beyond the Windows setup concern.

## Consequences

Each non-elevated setup run presents a UAC prompt before replacing the scheduled task. The prompt must be approved by the initiating Windows account; credentials for another administrator fail rather than register the task under a different user. Once started, the authenticated Web application can perform administrator-level effects through its tools, so the launch URL and token are administrator credentials for this local deployment.
