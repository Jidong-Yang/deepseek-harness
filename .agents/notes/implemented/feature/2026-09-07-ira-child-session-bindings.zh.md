# Agent Note：普通 IRA child Session

状态：已实现

[English](2026-09-07-ira-child-session-bindings.md) | 中文

## 问题

原生 subagent composition 继承父 preset，不能表达 Platform Supervisor 在 Provider 上选择独立的实现或验证角色。任务文本中的角色名称不等于不同的 composition。

## 决策

[IRA Provider](https://github.com/Jidong-Yang/deepseek-harness/blob/b5a32b12c6bf0dea4d1c26ef1f3db50172e1343d/packages/integration/ira-provider/src/index.ts) 必须具备 AgentPresets，并复用普通 SessionController 创建和 steer 路径。它上报已安装且健康的受支持 ID，在 open 前验证目标 preset，在安装角色工具或 steer/cancel 前核对实际 composition。缺失角色不会回退。

Supervisor 获得 Hub child-task 工具。Worker 和 Validator 只有自身 context/report Hub 工具，不获得父 capability 或 settlement 工具。正式 Supervisor 委派和 child 递归不能走继承的原生 subagent/workflow 工具。Scoped restriction 与 guard 覆盖晚注册和同 scope shadow；这不是 OS sandbox。KB 拥有专业角色，Platform 拥有薄执行绑定和父子关系。

Hub HTTP 请求身份使用已有 Session/tool-call ID，而不是时钟。请求传递 signal，额外参数不能覆盖绑定的方法。不引入新队列、收据服务、MCP 进程或核心 Session 运行时。

## 考虑过的替代方案

继承 Supervisor 的 subagent 不能提供独立专业 composition。第二套任务运行时会重复已有 SessionController 能力。把持久化输入 ID 当作完整跨 Host 执行收据会掩盖尚未解决的 claim/admission 恢复边界；该工作继续延期。

## 影响

这里是 child-session 分支的源码交付，不是已部署激活。

### 验证与边界

真实 Loader 测试组合 SessionController、AgentPresets、AgentLoop 与 JSONL 持久化。离线请求包含正确 persona/工具；cold list/inspect 不激活 Agent，显式同 ID resume 保留普通历史。注册表测试覆盖晚注册及 shadow 后的禁止工具。

另一次临时 source-mode 验证使用 Platform 官方生成的六个 preset，不改写其嵌套 Include/PTC 或 policy，核对 canonical persona/SDK 与普通 Session 身份。实际已安装 CLI 的模块查找拓扑是前置条件；loader 路径别名本身不是包健康证据。未验证真实模型、Teams、产品工具执行或已部署 Host。

跨 Host 重复接收、pending inbox 唤醒、claim 到模型 admission 的崩溃窗口、持久化取消身份继续延期。稳定的 Hub 请求 ID 不会把进程内 Provider 分派去重变成 exactly-once 执行。
