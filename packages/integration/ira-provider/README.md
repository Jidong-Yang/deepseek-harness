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

Mount this function plugin as an IRA-specific Host composition row. The Host supplies SessionController and WorkspaceRegistry; the external Hub supplies command routing and authentication. The plugin does not start a replacement Web server or an MCP server.

| Field | Default | Meaning |
|---|---|---|
| `hubUrl` | Required | Hub WebSocket URL. |
| `providerId` | Required | This Provider identity. |
| `token` | Required | Bearer credential sent only on the Hub connection. |
| `workspaces` | Required | Stable workspace names mapped to local paths; includes `ira-agent-platform`. |
| `reconnectMs` | `1000` | Delay between failed or closed connections. |

An invalid command frame closes the connection with code 1008 without logging its payload. The Provider reconnects through the same loop. Valid command failures return a failed result; the Hub owns retry decisions. A transport failure while sending a result cannot establish whether the Hub received it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The [entry module](src/index.ts) resolves local workspaces, owns the outbound socket, and dispatches commands through SessionController. Router scopes inherit ADO tools; Devloop and Supervisor inherit ADO, Kusto, and Voice Dashboard tools; Schedule Manager inherits none of these MCP tools and cannot call `ask_user_question`. Existing registry notifications refresh name restrictions, while an execution guard enforces the same predicate. Agent-scope disposal releases the policy effects.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Hardening decision](../../../.agents/notes/implemented/bug-fix/2026-09-06-ira-provider-hardening.md)
- [Tool registry](../../core/tools/README.md)
- [Session persistence](../../session/session-persistence/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Scoped Hub tools and delivered prompts

#### What the model sees

The selected preset receives its Hub tool schemas, such as `ira_route` for Router and `ira_context` for Owner, and delivered user text. Session capabilities and the Hub tool URL stay in execution closures rather than user-message text. Tool descriptions and dynamic results are defined in the [entry module](src/index.ts); disallowed MCP tools are absent from schema assembly and rejected at execution.

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
