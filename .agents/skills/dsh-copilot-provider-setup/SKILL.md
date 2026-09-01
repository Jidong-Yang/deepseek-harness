---
name: dsh-copilot-provider-setup
description: "Use after checking out this DeepSeek Harness fork to bootstrap or restore the complete Windows development deployment: install Bun and pnpm when missing, clone and authenticate C:\\DSH\\copilot-dsh-provider, install/build/start both applications, and bind the provider's live model catalog into dsh without exposing GitHub credentials."
---

# Bootstrap dsh with the local Copilot model provider

Starting from a checkout of this fork, establish its complete customary Windows development deployment. Treat `C:\DSH\copilot-dsh-provider` as the local custom-model provider checkout. Keep the deployment machine-local: the provider uses undocumented GitHub Copilot inference endpoints, so do not add it to shipped profiles, package dependencies, examples, snapshots, or the root agent context.

## Conventional deployment

Use these values unless the provider's current README or running server explicitly says otherwise:

| Setting | Value |
|---|---|
| Provider repository | `https://github.com/Jidong-Yang/copilot-dsh-provider.git` |
| Source checkout | `C:\DSH\copilot-dsh-provider` |
| Responses route | `copilot-proxy` |
| Responses display name | `GitHub Copilot` |
| Responses base URL | `http://127.0.0.1:4141/responses/v1` |
| Responses protocol | `openai-responses` |
| Chat route | `copilot-chat` |
| Chat display name | `GitHub Copilot Chat` |
| Chat base URL | `http://127.0.0.1:4141/chat/v1` |
| Chat protocol | `openai-completions` |
| Request retry policy | normal, one retry for `EMPTY_RESPONSE`, `RATE_LIMIT`, `SERVER`, `TIMEOUT`, and `TRANSPORT` |
| Placeholder authorization | `Bearer local-copilot-provider` |
| dsh settings namespace | `llm-pi-ai` |
| Default dsh settings document | `%USERPROFILE%\.dsh\settings.yaml` |
| Harness scheduled task | `DeepSeek Harness Web` |
| Harness Web URL | `http://127.0.0.1:3080` |

The provider ignores inbound API credentials. Never copy its GitHub token, Copilot token, auth file, or response headers into dsh settings, logs, commits, or chat output. Keep the server bound to loopback.

## Bootstrap the machine

Perform these phases in order. Inspect before acting and reuse a valid existing installation, checkout, build, authenticated provider, or listening service.

### 1. Prepare the provider

1. Require Windows with `git` and `winget`. Fail with the missing prerequisite instead of substituting an unrelated installer.
2. Install Bun only when `bun --version` fails:

   ```powershell
   winget install -e --id Oven-sh.Bun
   ```

   Refresh command discovery after installation; do not assume the current process inherited the updated `PATH`.
3. If `C:\DSH\copilot-dsh-provider` does not exist, clone the conventional repository there:

   ```powershell
   git clone https://github.com/Jidong-Yang/copilot-dsh-provider.git C:\DSH\copilot-dsh-provider
   ```

   If the path exists, verify it is a Git worktree for that repository. Never delete, overwrite, reset, clean, pull, or switch its branch merely to make setup continue.
4. Read its `README.md` and `package.json` before running commands; those files own current prerequisites, authentication, and startup details.
5. Run `bun install` in the provider checkout.
6. On a new machine, or when provider authentication is absent or rejected, run `bun run auth`. Surface its device-flow URL and code to the user and wait for authorization to complete. Never capture or print the stored GitHub token.
7. If `GET http://127.0.0.1:4141/health` is not already healthy, start `bun run start` from the provider checkout as a detached process. Verify that port `4141` is listening on `127.0.0.1` and the health endpoint succeeds. Do not start a duplicate or kill an unrelated listener.

### 2. Prepare DeepSeek Harness

1. Treat the repository containing this skill as the dsh checkout; do not clone a second copy.
2. From the dsh repository root, run its idempotent Windows deployment:

   ```powershell
   .\setup.ps1
   ```

   The script installs or updates pnpm through winget, validates Node.js, installs dependencies, builds the checkout, publishes the Copilot bridge, and registers and starts the `DeepSeek Harness Web` Task Scheduler task. Stop on failure; do not substitute manual package-manager, build, settings, or process steps after a partial setup.
3. Use `-SkipCopilotBridge` only when the requested deployment intentionally excludes the local Copilot provider:

   ```powershell
   .\setup.ps1 -SkipCopilotBridge
   ```

### 3. Verify the live catalog bridge

1. Resolve the active dsh home from the scheduled task and inspect its `settings.yaml`. The setup must preserve every unrelated settings namespace and every field outside `llm-pi-ai.providers.copilot-proxy` and `llm-pi-ai.providers.copilot-chat`.
2. Fetch `GET http://127.0.0.1:4141/responses/v1/models` and `GET http://127.0.0.1:4141/chat/v1/models`. Require each configured route's model ids to match its corresponding live catalog and at least one model across the two routes.
3. Require both non-empty routes to carry their conventional identities, endpoints, protocols, shared `apiKeyEnv` placeholder reference, and this retry policy:

   ```yaml
   retryPolicy:
     mode: normal
     maxRetries: 1
     retryableCodes:
       - EMPTY_RESPONSE
       - RATE_LIMIT
       - SERVER
       - TIMEOUT
       - TRANSPORT
   ```

   The scheduled process supplies the non-secret placeholder value. The provider already performs one internal authentication recovery; this single Harness retry covers a transient request failure without multiplying complete generations. Require the bridge's model mapping to preserve:
   - `id` to `id`;
   - `display_name` to `name` when present;
   - `context_window` to `contextWindow` when it is a positive integer;
   - `max_output_tokens` to `maxTokens` when it is a positive integer;
   - `input` to `input` when it is a non-empty list of dsh-supported modalities;
   - `reasoning_efforts` to `reasoningEfforts` when it is a non-empty map whose keys are dsh-supported levels and whose values are non-empty wire spellings or `null` for `off`.
4. Confirm that a protocol route with an empty live catalog is absent rather than retaining stale models. Never hand-edit the managed credential store.

## Verify the deployment

Require all of the following before reporting success:

1. The provider health endpoint and both protocol-specific model endpoints answer, and each configured route's model ids match its live catalog.
2. The dsh Models page shows both conventional routes, protocols, loopback base URLs, and complete configured catalogs.
3. A bounded request completes through each non-empty protocol route. When a catalog advertises images or reasoning levels, the request includes a generated small image and one advertised non-`off` level so the live wire integration is exercised without reading user files.
4. dsh and the provider processes remain listening on their expected loopback ports.

Do not claim that dsh exercised the route when only the provider-direct request ran. The Models page proves live registration and catalog publication; a dsh-created session proves model execution through the harness when the user requests that stronger check.

## Diagnose failures

- **Provider absent:** inspect the documented Bun command and the process bound to port `4141`; do not kill unrelated processes by name.
- **Connection refused:** inspect the `Copilot DSH Provider` Task Scheduler task and its visible PowerShell window. Do not replace the route, API key, or model configuration merely because the machine-local process is stopped.
- **Health `checking`:** wait briefly and check again; do not start a duplicate provider process.
- **Health `upstream-unavailable`:** retry with bounded backoff. Do not run Device Flow because network, throttling, and upstream 5xx failures do not reject the stored credential.
- **Health `reauth-required`:** use the safe health `code` to distinguish `github-credential-rejected` from `copilot-access-rejected`. For a rejected GitHub credential, run `bun run auth` in `C:\DSH\copilot-dsh-provider`, then recheck health; the running provider reloads the saved credential without a restart. Copilot access rejection requires restoring the account's Copilot entitlement or enterprise access.
- **Bun or pnpm still unavailable after winget succeeds:** locate the installed executable or begin a fresh process with the updated user or machine `PATH`; do not reinstall repeatedly.
- **Device Flow pending:** show the URL and one-time code, then wait. Do not treat user-paced authorization as a hung process.
- **Existing checkout differs:** report its path, branch, dirty state, and remote mismatch. Do not rewrite or replace it without explicit approval.
- **dsh build or startup fails:** report the exact existing command and failure. Do not continue to settings as though the runtime were healthy.
- **Harness task absent or stopped:** rerun the root `setup.ps1`; do not start a separate unmanaged `pnpm dsh web` process.
- **Provider healthy but route absent:** inspect the `llm-pi-ai` namespace rejection and validate the profile against the installed adapter schema. Keep the last good settings section intact.
- **Models missing capabilities:** compare the raw listing with the installed `LlmDiscoveredModel` and `PiAiModelProfile` types. Preserve supported extensions through structural settings when discovery narrows them.
- **401 or “provider is not configured”:** verify that each route's `apiKeyEnv` reference resolves to the non-secret placeholder. Do not substitute a GitHub credential.
- **Stale catalog:** refetch both protocol-specific listings and replace only the corresponding route's `models`; the catalogs never refresh themselves.
