---
name: dsh-copilot-provider-setup
description: "Use after checking out this DeepSeek Harness fork to bootstrap or restore the complete Windows development deployment: install Bun and pnpm when missing, clone and authenticate C:\\copilot-dsh-provider, install/build/start both applications, and bind the provider's live model catalog into dsh without exposing GitHub credentials."
---

# Bootstrap dsh with the local Copilot model provider

Starting from a checkout of this fork, establish its complete customary Windows development deployment. Treat `C:\copilot-dsh-provider` as the local custom-model provider checkout. Keep the deployment machine-local: the provider uses undocumented GitHub Copilot inference endpoints, so do not add it to shipped profiles, package dependencies, examples, snapshots, or the root agent context.

## Conventional deployment

Use these values unless the provider's current README or running server explicitly says otherwise:

| Setting | Value |
|---|---|
| Provider repository | `https://github.com/blackflag0623/copilot-dsh-provider.git` |
| Source checkout | `C:\copilot-dsh-provider` |
| Provider route | `copilot-proxy` |
| Display name | `GitHub Copilot` |
| Base URL | `http://127.0.0.1:4141/v1` |
| Protocol | `openai-responses` |
| Placeholder authorization | `Bearer local-copilot-provider` |
| dsh settings namespace | `llm-pi-ai` |
| Default dsh settings document | `%USERPROFILE%\.dsh\settings.yaml` |

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
3. If `C:\copilot-dsh-provider` does not exist, clone the conventional repository there:

   ```powershell
   git clone https://github.com/blackflag0623/copilot-dsh-provider.git C:\copilot-dsh-provider
   ```

   If the path exists, verify it is a Git worktree for that repository. Never delete, overwrite, reset, clean, pull, or switch its branch merely to make setup continue.
4. Read its `README.md` and `package.json` before running commands; those files own current prerequisites, authentication, and startup details.
5. Run `bun install` in the provider checkout.
6. On a new machine, or when provider authentication is absent or rejected, run `bun run auth`. Surface its device-flow URL and code to the user and wait for authorization to complete. Never capture or print the stored GitHub token.
7. If `GET http://127.0.0.1:4141/health` is not already healthy, start `bun run start` from the provider checkout as a detached process. Verify that port `4141` is listening on `127.0.0.1` and the health endpoint succeeds. Do not start a duplicate or kill an unrelated listener.

### 2. Prepare DeepSeek Harness

1. Treat the repository containing this skill as the dsh checkout; do not clone a second copy.
2. Install pnpm only when `pnpm --version` fails:

   ```powershell
   winget install -e --id pnpm.pnpm
   ```

   Refresh command discovery after installation and require the version accepted by this checkout's `packageManager` and engine declarations.
3. From the dsh repository root, run:

   ```powershell
   pnpm install
   pnpm run build
   ```

   Stop on either failure. Do not edit manifests, relax lockfile checks, or substitute another package manager.
4. If the dsh Web endpoint is not already healthy, start `pnpm dsh web` from the repository root as a detached process. Use the URL printed by dsh, defaulting to `http://127.0.0.1:3080` only when the active process reports no override. Verify the listener and an HTTP response before continuing.

### 3. Bind the live catalog

1. Resolve the active dsh home rather than assuming the default when the process or environment names another one. Preserve every unrelated settings namespace and every field outside `llm-pi-ai.providers.copilot-proxy`.
2. Fetch `GET http://127.0.0.1:4141/v1/models`. Require a non-empty list with unique, non-empty model ids. Treat this response as the catalog for this deployment; do not retain models that disappeared or invent models, capacities, modalities, or reasoning levels.
3. Upsert `llm-pi-ai.providers.copilot-proxy` with the conventional identity, endpoint, protocol, and `headers.Authorization` placeholder. Replace only this route's `models` list with the live response, mapping:
   - `id` to `id`;
   - `display_name` to `name` when present;
   - `context_window` to `contextWindow` when it is a positive integer;
   - `max_output_tokens` to `maxTokens` when it is a positive integer;
   - `input` to `input` when it is a non-empty list of dsh-supported modalities.
4. Do not add `reasoningEfforts` unless an authoritative provider response or provider document declares the exact selectable levels and wire spellings. A model default remains usable without a dsh reasoning selector.
5. Prefer the live settings mutation API or Models UI when it preserves every catalog field above. When the installed dsh discovery type drops an extension such as `input`, update the settings document structurally instead. Never replace the whole YAML document or hand-edit the managed credential store.

The settings-file provider hot-loads a valid change. Do not restart dsh merely to publish this route.

## Verify the deployment

Require all of the following before reporting success:

1. Both provider endpoints still answer, and the model ids in `/v1/models` match the configured route.
2. The dsh Models page shows `GitHub Copilot`, route `copilot-proxy`, protocol `openai-responses`, the loopback base URL, and the complete configured catalog.
3. A minimal `POST /v1/responses` with the placeholder authorization completes against one currently listed model. Keep the prompt harmless and the output bound small.
4. dsh and the provider processes remain listening on their expected loopback ports.

Do not claim that dsh exercised the route when only the provider-direct request ran. The Models page proves live registration and catalog publication; a dsh-created session proves model execution through the harness when the user requests that stronger check.

## Diagnose failures

- **Provider absent:** inspect the documented Bun command and the process bound to port `4141`; do not kill unrelated processes by name.
- **Bun or pnpm still unavailable after winget succeeds:** locate the installed executable or begin a fresh process with the updated user or machine `PATH`; do not reinstall repeatedly.
- **Device Flow pending:** show the URL and one-time code, then wait. Do not treat user-paced authorization as a hung process.
- **Existing checkout differs:** report its path, branch, dirty state, and remote mismatch. Do not rewrite or replace it without explicit approval.
- **dsh build or startup fails:** report the exact existing command and failure. Do not continue to settings as though the runtime were healthy.
- **Provider healthy but route absent:** inspect the `llm-pi-ai` namespace rejection and validate the profile against the installed adapter schema. Keep the last good settings section intact.
- **Models missing capabilities:** compare the raw listing with the installed `LlmDiscoveredModel` and `PiAiModelProfile` types. Preserve supported extensions through structural settings when discovery narrows them.
- **401 or “provider is not configured”:** verify the placeholder `Authorization` header is present on the route. Do not substitute a GitHub credential.
- **Stale catalog:** refetch and replace only `copilot-proxy.models`; the catalog never refreshes itself.
