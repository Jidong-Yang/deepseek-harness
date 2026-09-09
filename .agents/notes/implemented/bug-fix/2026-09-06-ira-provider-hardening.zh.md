# Agent Note: IRA Provider 边界加固

Status: implemented

[English](2026-09-06-ira-provider-hardening.md) | 中文

## Problem

嵌入式 IRA Provider 与 DSH Web 共用进程，因此未捕获的帧解析错误可能影响无关 Session。全局 MCP 服务可能在 Session 启动后恢复，仅在 Hub 投递时获取工具名称快照，无法在恢复期间持续执行 preset 策略。

## Decision

[Provider](../../../../packages/integration/ira-provider/src/index.ts) 在创建或 steer Session 之前验证命令。无效网络帧以协议错误关闭连接；socket 错误结束当前连接，由连接循环负责重试。断连释放 heartbeat 和 abort 监听器。响应发送会限制传输错误，不产生游离的 rejected Promise。

Agent-scoped restriction 监听现有未按 scope 过滤的 tools/change 通知，执行 guard 在分派时应用同一判断。注册表与 Agent scope 拥有这些 effect；不引入共享 MCP broker、新的工具过滤 API 或额外恢复服务。

Lockfile 保留合并前的外部包 resolution 和 peer context。本次修复仅增加 IRA workspace importer 及既有 invariant companion 依赖。

## Alternatives considered

**仅在 Human Reply 时刷新。** MCP 恢复后，工具仍可能在当前运行中的 turn 暴露，包括首次接收时服务尚未就绪的情形。

**替换全部依赖 resolution。** 修复一个缺失的 workspace importer，不足以支持同时修改制品下载路径、完整性算法及无关 peer 选择。

**把 inbox 插入视为命令完成。** 稳定消息 ID 配合现有 Session flush 可以防止重复接收，但本身无法恢复待执行工作，也无法覆盖领取消息到模型接收之间的崩溃窗口。直接采用这种简化会用成功 ACK 掩盖投递失败。

## Consequences

Focused tests 使用真实 ToolRuntime 验证晚注册工具的拒绝行为，并用本地 WebSocket server 验证无效帧后的恢复。包内 Loader composition 验证实际插件挂载。测试不需要生产 Hub、模型请求或 Teams thread。

跨 Host 的投递去重仍未解决。[Inbox 接口](../../../../packages/core/agent/src/runtime-types.ts) 记录插入身份，但仅拒绝仍在等待的重复身份。[Agent loop](../../../../packages/core/agent-loop/src/agent.ts) 在异步 prompt assembly 和后续 user/message 接收之前移除已领取的输入。[Session store](../../../../packages/core/session/src/index.ts) 提供可等待的 flush，而非原子命令执行事务。Cancel 也没有持久化命令身份。在用历史收据替换 Provider 的进程内去重前，必须明确恢复和取消语义。
