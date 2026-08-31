# Agent Note: Local Copilot provider setup is an on-demand skill

Status: implemented

English | [中文](2026-08-24-local-copilot-provider-setup.zh.md)

## Problem

This fork routinely uses the separate `C:\copilot-dsh-provider` checkout as a local custom model provider. A new Windows development machine otherwise requires a second clone, two package managers, dependency installation, provider Device Flow authentication, two long-running processes, route configuration, model synchronization, placeholder authentication, and verification. Reconstructing that sequence in each session is error-prone. The deployment is still machine-specific and relies on undocumented GitHub Copilot inference endpoints, so placing it in every agent's default project context or in shipped dsh profiles would present a local convention as a product requirement.

## Decision

The project-level [`dsh-copilot-provider-setup`](../../../skills/dsh-copilot-provider-setup/SKILL.md) skill owns the complete bootstrap and recurring integration procedure. Starting from this fork's checkout, it installs missing Bun and pnpm through winget, clones the provider into its conventional path when absent, installs both repositories' dependencies, guides provider Device Flow authentication, builds dsh, and starts both loopback services. It reuses valid existing installations, checkouts, authentication, builds, and processes, and never rewrites an existing worktree to force it into the convention.

The conventional deployment uses provider repository `https://github.com/Jidong-Yang/copilot-dsh-provider.git`. The `copilot-proxy` route serves `openai-responses` from `http://127.0.0.1:4141/responses/v1`, while `copilot-chat` serves `openai-completions` from `http://127.0.0.1:4141/chat/v1`. The skill reads the provider's current README and both live protocol-specific model listings before writing configuration, preserves unrelated settings, and synchronizes only those two routes. It carries a non-secret placeholder authorization because the provider ignores inbound credentials; GitHub and Copilot tokens never enter dsh settings.

The provider's live catalogs own model membership and disclosed metadata. The setup preserves capacities, supported input modalities, and exact reasoning-level wire spellings. Verification covers provider readiness, live dsh registration, both catalogs, bounded requests through each populated protocol route, advertised image and reasoning inputs, and both loopback listeners.

The provider remains outside shipped profiles, package manifests, examples, and snapshots. Its unsupported upstream API and fixed local checkout path are deployment facts of this fork, not behavior every DeepSeek Harness installation can satisfy.

## Alternatives considered

**Add the setup to root `AGENTS.md`.** Rejected because every task would carry machine-specific paths, ports, and unsupported-provider details even when no model configuration work is involved. A skill supplies the same standing availability without consuming default context.

**Enable the provider in the base or Web bundle.** Rejected because a shipped profile would require an unrelated local checkout and an undocumented external API. Other developers and release artifacts cannot satisfy that dependency.

**Keep the procedure only in `copilot-dsh-provider` documentation.** Rejected because that README explains how its server integrates with dsh but does not establish this fork's persistence, refresh, preservation, and verification rules.

**Hardcode the current model list in the skill.** Rejected because Copilot's available models and metadata change independently. The running provider's protocol-specific model listings are the deployment's current source.

## Consequences

One instruction after checking out this fork can establish the remaining local deployment without making it a product default. Model additions, removals, capacities, modalities, and reasoning levels follow the running provider instead of aging in repository prose. Models available only through Chat Completions remain usable beside Responses models. Device Flow remains user-paced, Windows and winget are explicit prerequisites, and provider or dsh command changes can require updating this skill.
