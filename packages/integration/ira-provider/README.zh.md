---
description: "将 IRA Hub 命令连接到 DSH Session，并执行 Agent 专属的 MCP 工具访问限制。"
kind: "package-reference"
---
# @deepseek-ai/dsh-ira-provider

[English](README.md) | 中文

## 概述

此插件在拥有目标 Session 的 DSH Host 中接收已认证的 IRA Hub 命令，将回复送入对应 Session 并安装 Hub 工具。MCP 工具访问遵循选定的 IRA preset，包括服务重连后注册的工具。命令成功确认的是本地分派，而非持久化或执行完成。

## 目录

- [使用此包](#use-this-package)
- [实现概述](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待定事项](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

将此函数插件挂载为 IRA 专属的 Host composition 条目。Host 提供 SessionController、WorkspaceRegistry、AgentPresets 和 Tools，外部 Hub 提供命令路由与认证。插件不启动替代 Web server 或 MCP server。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `hubUrl` | 必填 | Hub WebSocket URL。 |
| `providerId` | 必填 | 此 Provider 的身份。 |
| `token` | 必填 | 仅用于 Hub 连接的 bearer 凭据。 |
| `workspaces` | 必填 | 稳定 workspace 名称到本地路径的映射；包含 `ira-agent-platform`。 |
| `reconnectMs` | `1000` | 连接失败或关闭后的重试间隔。 |

每次连接公布 `catalog.agentPresets`：`ira-intake-router`、`ira-devloop`、`ira-supervisor`、`ira-schedule-manager`、`ira-devloop-worker` 和 `ira-e2e-validator` 中已安装且健康的 ID。Open 命令重新检查安装与健康状态；每条命令必须匹配 Session 的实际 composition。缺失的 preset 不会回退到默认值。

无效命令帧以 1008 关闭连接，不记录原始载荷。Provider 通过同一循环重连。合法命令执行失败时返回失败结果，由 Hub 决定是否重试。发送结果时发生传输错误，不能据此判断 Hub 是否已经收到结果。

-----

<a id="understand-the-implementation"></a>
## 实现概述

<details>
<summary>实现细节</summary>

[入口模块](src/index.ts) 解析本地 workspace，拥有出站 socket，并通过 SessionController 分派命令。Router scope 继承 ADO 工具；Devloop、Supervisor 和 Devloop Worker 继承 ADO、Kusto、Voice Dashboard 工具；Schedule Manager 和 E2E Validator 不继承这些 MCP 工具。Schedule Manager 与两个 child 角色不能调用 `ask_user_question`。Supervisor 只通过 Hub child-task 路径委派，不使用继承的原生委派。Child scope 隐藏继承的委派与 owner 报告工具，并拒绝执行这些工具。这是工具级策略，不是 OS sandbox。既有注册表通知刷新名称限制，执行 guard 使用同一判断。Agent scope 释放时清理策略 effect。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [普通 child Session 决策](../../../.agents/notes/implemented/feature/2026-09-07-ira-child-session-bindings.zh.md)
- [加固决策](../../../.agents/notes/implemented/bug-fix/2026-09-06-ira-provider-hardening.zh.md)
- [工具注册表](../../core/tools/README.zh.md)
- [Session 持久化](../../session/session-persistence/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### Scoped Hub 工具与投递文本

#### 模型看到什么

每个合法 Session 都接收 `ira_context`，角色工具由实际 composition 决定。Supervisor 另有 `ira_providers`、owner 报告工具及 `ira_child_task`（`create`、`continue`、`settle`、`resume`）。Child 角色只有 `ira_context` 和 `ira_child_report`（`progress`、`blocker`、`complete`）作为 Hub 工具。Child 完成报告既不结算 child，也不结算 owner；只有所属 Supervisor 决定是否接受。Child 是由 SessionController 创建的普通 Session，拥有独立 preset 与历史；只有 Hub 持有父子关系，不使用原生 subagent 继承。Session capability 和 Hub 工具 URL 保留在执行闭包中，不进入用户消息文本。HTTP 身份来自现有 Session/tool-call ID，fetch 遵循工具 signal；额外参数不能覆盖绑定的 Hub 方法。这不是持久化的 Provider 执行收据。工具描述和动态结果由[入口模块](src/index.ts)定义；不允许的 MCP 工具不会进入 schema assembly，执行时也会被拒绝。

#### Token 影响

Hub schema 增加请求 token，投递文本与工具结果增加对话历史。移除无关 MCP schema 会缩小可见工具目录。

#### KV Cache 影响

投递消息追加历史。目录新增和限制更新可能改变工具定义前缀；目录不变时，该前缀保持稳定。缓存可用性仍由模型提供方决定。

## 已知限制与待定事项

<a id="known-limitations-and-deferred-work"></a>

投递恢复具有明确限制。

- 命令去重仅存在于进程内。在分派与 Hub 确认之间重启 Host，可能产生重复输入。不提供持久化收据或 exactly-once 执行保证。
- 仅持久化 inbox 插入不足以安全恢复：待处理工作需要唤醒，领取输入后、模型接收前的崩溃需要明确恢复规则。因此没有把历史 ID 抑制作为局部修复安装。
- 取消针对当前活动，没有持久化命令身份。重放 cancel 不绑定原始 turn。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
