# Agent Note: Windows Host startup readiness

Status: implemented

English | [中文](2026-09-07-windows-host-startup-readiness.zh.md)

## Problem

A Windows supervisor needs evidence that its Host attempt completed startup without parsing output, depending on Hub connectivity, or accepting another process’s listening port. Module import can finish after an early clean shutdown, so import completion alone cannot establish success.

## Decision

The Windows runner consumes an optional attempt-specific file and nonce before Host environment capture. The CLI exposes its existing `AppReady` handle and a narrow local authenticated-URL getter, never the Host context. The runner subscribes after import and publishes only when that launcher-owned latch commits. The [CLI reference](../../../../apps/cli/reference/README.md#windows-supervisor-startup-record) owns the inputs, JSON fields and filesystem requirements. There is no new plugin, profile, telemetry event or readiness state owner.

Publication uses an exclusively created and flushed temporary file followed by a hard link to an absent destination. Hard-link creation gives atomic visibility without overwriting a raced file or link. The caller owns a private, stable attempt directory; ancestor inspection is not a security guarantee against an administrator who replaces that directory concurrently.

Authenticated browser URLs use an optional, nonce-bound current-user pipe rather than the readiness file or general stdout. The one-shot bounded sender runs only after AppReady publication and never echoes credentials in failures. This gives the supervising local console a usable entry without retaining Host/Session output or putting credentials into operational reports.

## Alternatives considered

**Publish after import or HTTP success.** Rejected because a disposed tree can return normally, and an HTTP carrier can listen before sibling activation and launcher setup finish.

**Use the printed Web URL or Hub heartbeat.** Rejected because output can contain credentials and is not a machine startup record; Hub availability describes a different component. The [browser handoff decision](../feature/2026-08-12-open-ready-web-ui.md) remains separate and unchanged.

**Rename over the final path.** Rejected because replacement semantics can overwrite an existing or raced destination. A same-directory hard link requires local filesystem support but refuses replacement atomically.

## Consequences

Absent optional variables preserve ordinary startup. Validation and publication failures report static diagnostics without supplied values. The supervisor still owns process/Job liveness, nonce validation, deadlines and retention; a startup record is not a health lease or PID-based termination authority. Nonfatal MCP failures remain governed by plugin startup semantics, not a second readiness policy.

Verification exercises the real Windows runner with disposable profile fixtures, delayed activation, failure and early disposal, post-commit subscription, request removal from the Host snapshot and a child environment, and no-replace publication failures. No real home, browser listener, Hub, Session or production task is involved.
