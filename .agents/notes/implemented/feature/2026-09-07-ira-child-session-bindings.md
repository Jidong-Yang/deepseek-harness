# Agent Note: Ordinary IRA child Sessions

Status: implemented

English | [中文](2026-09-07-ira-child-session-bindings.zh.md)

## Problem

Native subagent composition inherits its parent preset. That cannot represent a Platform Supervisor selecting a separate implementing or independent validation role on a Provider. A role name in task prose is not a different composition.

## Decision

The [IRA Provider](../../../../packages/integration/ira-provider/src/index.ts) requires AgentPresets and uses the existing ordinary SessionController creation and steering path. It advertises healthy installed supported IDs, validates the requested preset before open, and checks actual composition before role tools are installed or a Session is steered/cancelled. Missing roles do not fall back.

Supervisor receives the Hub child-task tool. Worker and Validator receive only their own context/report Hub tools, not parent capabilities or settlement tools. Formal Supervisor delegation and child recursion cannot use inherited native subagent/workflow tools. Scoped restriction plus guard covers late registration and same-scope shadows; this is not an OS sandbox. KB owns role expertise and Platform owns thin execution bindings and the parent relationship.

Hub HTTP request identity uses the existing Session/tool-call ID rather than a clock. The call forwards its signal and does not permit arguments to override its bound method. No new queue, receipt service, MCP process or core Session runtime is introduced.

## Alternatives considered

Using an inherited Supervisor subagent does not provide an independent professional composition. A second task runtime would duplicate existing SessionController capabilities. Treating a persisted input ID as a complete cross-Host execution receipt would conceal the unresolved claim/admission recovery boundary; that work remains deferred.

## Consequences

This is source delivery on the child-session branch, not deployed activation.

### Verification and limits

Real Loader tests use SessionController, AgentPresets, AgentLoop and JSONL persistence. Offline requests carry correct role persona/tools. Cold list and inspect do not activate Agents; explicit same-ID resume retains ordinary history. Registry tests cover late and shadowed forbidden tools.

A separate temporary source-mode qualification used official Platform-generated six presets without rewriting their nested Include/PTC or policy, and verified canonical persona/SDK and ordinary identities. Real installed CLI module lookup topology was necessary; loader path aliases alone were not package health. No live model, Teams, product tool execution or deployed Host was qualified.

Cross-Host repeat reception, pending inbox waking, the claim-to-model-admission crash window and durable cancellation identity remain deferred. Stable Hub request IDs do not turn process-local Provider dispatch dedup into exactly-once execution.
