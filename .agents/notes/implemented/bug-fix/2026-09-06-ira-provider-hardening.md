# Agent Note: IRA Provider boundary hardening

Status: implemented

English | [中文](2026-09-06-ira-provider-hardening.zh.md)

## Problem

The embedded IRA Provider shares a process with DSH Web. An uncaught frame parse error can therefore affect unrelated Sessions. Global MCP servers can recover after a Session starts, so a tool-name snapshot taken only on Hub delivery does not enforce the preset policy during recovery.

## Decision

The [Provider](../../../../packages/integration/ira-provider/src/index.ts) validates commands before creating or steering Sessions. Invalid network frames close the connection with a protocol error; socket errors settle the connection loop, which owns retry. Disconnection releases heartbeat and abort listeners. Reply sends contain transport failures rather than creating detached rejected promises.

Agent-scoped restrictions follow the existing unfiltered tools/change notification. An execution guard applies the same predicate at dispatch. The registry and Agent scope own those effects; no shared MCP broker, new tool-filter API, or additional recovery service is introduced.

The lockfile preserves premerge external package resolution records and peer contexts. Only the IRA workspace importer and the existing invariant-companion dependency belong to this repair.

## Alternatives considered

**Refresh only on Human Reply.** This leaves tools available during a running turn after MCP recovery, including when the server was absent at initial admission.

**Replace all dependency resolutions.** Repairing one missing workspace importer does not justify changing artifact routes, integrity algorithms, or unrelated peer selection.

**Treat an inbox insertion as a completed command.** A stable message ID plus the existing Session flush can prevent repeat admission, but it cannot by itself recover pending work or bridge the claim-to-model-admission crash window. Installing that shortcut would hide a delivery failure behind a successful ACK.

## Consequences

Focused tests use a real ToolRuntime for late-registration denial and a loopback WebSocket server for invalid-frame recovery. A package-owned Loader composition verifies actual plugin mounting. No production Hub, model request, or Teams thread is needed.

Cross-Host delivery deduplication remains unresolved. The [inbox](../../../../packages/core/agent/src/inbox.ts) logs insertion identities, but only rejects identities that are still pending. The [agent loop](../../../../packages/core/agent-loop/src/agent.ts) removes claimed input before asynchronous prompt assembly and later user/message admission. The [Session store](../../../../packages/core/session/src/index.ts) exposes an awaited flush, not an atomic command execution transaction. Cancel also has no durable command identity. Recovery and cancellation semantics require an explicit decision before replacing the Provider's process-local deduplication with historical receipts.
