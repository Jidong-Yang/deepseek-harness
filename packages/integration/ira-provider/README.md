---
description: "Connect IRA Hub commands to DSH Sessions and enforce Agent-specific MCP tool access."
kind: "package-reference"
---
# @deepseek-ai/dsh-ira-provider

English | [中文](README.zh.md)

## Summary

Use this plugin to receive authenticated IRA Hub commands in the DSH Host that owns the target Sessions. It routes replies into those Sessions and installs their Hub tools. MCP tool access follows the selected IRA preset, including tools registered after a server reconnects. Command success acknowledges local dispatch, not durable or completed execution.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this function plugin as an IRA-specific Host composition row. The Host supplies SessionController, WorkspaceRegistry, AgentPresets, and Tools; the external Hub supplies command routing and authentication. The plugin does not start a replacement Web server or an MCP server.

| Field | Default | Meaning |
|---|---|---|
| `hubUrl` | Required | Hub WebSocket URL. |
| `providerId` | Required | This Provider identity. |
| `token` | Required | Bearer credential sent only on the Hub connection. |
| `workspaces` | Required | Stable workspace names mapped to local paths; includes `ira-agent-platform`. |
| `reconnectMs` | `1000` | Delay between failed or closed connections. |

Each connection advertises `catalog.agentPresets`: installed, healthy IDs among `ira-intake-router`, `ira-devloop`, `ira-supervisor`, `ira-schedule-manager`, `ira-devloop-worker`, and `ira-e2e-validator`. Open commands revalidate installation and health; every command must match the actual Session composition. Missing presets never fall back to a default.

An invalid command frame closes the connection with code 1008 without logging its payload. The Provider reconnects through the same loop. Valid command failures return a failed result; the Hub owns retry decisions. A transport failure while sending a result cannot establish whether the Hub received it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [entry module](src/index.ts) resolves local workspaces, owns the outbound socket, and dispatches commands through SessionController. Router scopes inherit ADO tools; Devloop, Supervisor, and Devloop Worker inherit ADO, Kusto, and Voice Dashboard tools; Schedule Manager and E2E Validator inherit none of these MCP tools. Schedule Manager and both child roles cannot call `ask_user_question`. Supervisor uses only the Hub child-task path, not inherited native delegation. Child scopes hide inherited delegation and owner-report tools and deny their execution. This is tool-level policy, not an OS sandbox. Existing registry notifications refresh name restrictions, while an execution guard enforces the same predicate. Agent-scope disposal releases the policy effects.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Ordinary child Session decision](../../../.agents/notes/implemented/feature/2026-09-07-ira-child-session-bindings.md)
- [Hardening decision](../../../.agents/notes/implemented/bug-fix/2026-09-06-ira-provider-hardening.md)
- [Tool registry](../../core/tools/README.md)
- [Session persistence](../../session/session-persistence/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Scoped Hub tools and delivered prompts

#### What the model sees

Every legitimate Session receives `ira_context`; role tools follow its verified composition. Supervisor additionally receives `ira_providers`, the owner reporting tools, and `ira_child_task` (`create`, `continue`, `settle`, `resume`). Child roles receive only `ira_context` and `ira_child_report` (`progress`, `blocker`, `complete`) as Hub tools. A child completion report settles neither child nor owner; only the owning Supervisor decides acceptance. Children are ordinary SessionController-created Sessions with independent presets and histories; the Hub alone owns their parent relationship. No native-subagent inheritance is used. Session capabilities and the Hub tool URL stay in execution closures rather than user-message text. HTTP identity derives from the existing Session/tool-call ID, and fetch follows the tool signal; extra arguments cannot override the bound Hub method. This is not a durable Provider execution receipt. Tool descriptions and dynamic results are defined in the [entry module](src/index.ts); disallowed MCP tools are absent from schema assembly and rejected at execution.

#### Token effect

Hub schemas add request tokens; delivered text and tool results add conversation history. Removing unrelated MCP schemas reduces the visible tool catalog.

#### KV Cache effect

Delivered messages append history. Catalog additions and restriction updates can change the tool-definition prefix; unchanged catalogs keep that prefix stable. Cache availability remains provider-owned.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Delivery recovery has explicit limits.

- Command deduplication is process-local. A Host restart between dispatch and Hub acknowledgement can cause repeated input. No durable receipt or exactly-once execution guarantee is provided.
- A persisted inbox insertion alone is insufficient for safe recovery: pending work needs waking, and a crash after claiming input but before model admission needs an explicit recovery rule. Historical-ID suppression is therefore not installed as a partial fix.
- Cancellation addresses live activity and has no durable command identity. A replayed cancel is not tied to the original turn.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
