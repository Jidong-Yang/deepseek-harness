# Agent Note: 本地 Copilot provider 的配置采用按需 skill

Status: implemented

[English](2026-08-24-local-copilot-provider-setup.md) | 中文

## Problem

此 fork 经常把独立的 `C:\DSH\copilot-dsh-provider` checkout 用作本地自定义模型 provider。新的 Windows 开发机原本还需要第二次 clone、两个 package manager、依赖安装、provider Device Flow 认证、两个长期运行的进程、路由配置、模型同步、占位鉴权和验证。每个会话都重新推导这套顺序，容易产生偏差。但该部署依赖本机环境和未公开的 GitHub Copilot 推理端点；如果把它放进每个 agent 的默认项目上下文或 dsh 随产品交付的 profile，就会把本地约定表达成产品要求。

## Decision

项目级 [`dsh-copilot-provider-setup`](../../../skills/dsh-copilot-provider-setup/SKILL.md) skill 负责完整的跨仓库 bootstrap 和重复使用的集成流程。它从此 fork 的 checkout 出发，准备 provider 并调用 Harness 的幂等 Windows 部署入口；根 `setup.ps1` 负责 Harness 依赖安装、构建、桥接发布和 Task Scheduler 生命周期（参见[决策](2026-09-01-windows-source-deployment-task.zh.md)）。skill 复用有效的既有安装、checkout、认证、build 和进程，绝不为了符合约定而重写现有 worktree。

约定部署使用 provider 仓库 `https://github.com/Jidong-Yang/copilot-dsh-provider.git`。`copilot-proxy` 路由通过 `http://127.0.0.1:4141/responses/v1` 提供 `openai-responses`，`copilot-chat` 则通过 `http://127.0.0.1:4141/chat/v1` 提供 `openai-completions`。skill 在写配置前读取 provider 当前的 README 和两个实时协议专用模型列表，保留无关设置，并且只同步这两个路由。provider 忽略入站凭据，因此配置使用非敏感的占位鉴权；GitHub 和 Copilot token 绝不进入 dsh settings。由于 provider 已执行自身的一次认证恢复，每条路由只允许 Harness 对瞬时故障或空响应重试一次。

provider 的实时目录决定模型成员及其公开元数据。setup 保留容量、支持的输入模态和精确的推理级别 wire 拼写。诊断流程解释 provider 的安全健康状态：`checking` 等待，`upstream-unavailable` 退避且不启动 Device Flow，`reauth-required` 区分 GitHub 凭据拒绝和 Copilot 访问拒绝。loopback 连接被拒绝时，流程指向 `Copilot DSH Provider` Task Scheduler 任务，而不是模型配置。验证覆盖 provider readiness、dsh 实时注册、两个目录、经由每个非空协议路由的有界请求、已公开的图像与推理输入，以及两个 loopback listener。

provider 不进入随产品交付的 profile、package manifest、示例或 snapshot。其未受支持的上游 API 和固定本地 checkout 路径是此 fork 的部署事实，并非每个 DeepSeek Harness 安装都能满足的行为。

## Alternatives considered

**把 setup 加入根 `AGENTS.md`。** 拒绝，因为每个任务都会携带本机路径、端口和未受支持 provider 的细节，即使任务与模型配置无关。skill 可提供同样的常备能力，同时不占用默认上下文。

**在 base 或 Web bundle 中启用 provider。** 拒绝，因为随产品交付的 profile 会依赖一个无关的本地 checkout 和未公开的外部 API，其他开发者和发布产物无法满足该依赖。

**只在 `copilot-dsh-provider` 文档中保留流程。** 拒绝，因为其 README 说明服务器如何与 dsh 集成，但不定义此 fork 的持久化、刷新、保留和验证规则。

**在 skill 中硬编码当前模型列表。** 拒绝，因为 Copilot 的可用模型和元数据会独立变化。运行中 provider 的协议专用模型列表是该部署的当前来源。

## Consequences

checkout 此 fork 后，一条指令就能建立剩余的本地部署，同时不把它设为产品默认。模型增删、容量、模态和推理级别跟随运行中的 provider，不会作为仓库 prose 逐渐过时。只能通过 Chat Completions 使用的模型可与 Responses 模型并行使用。Device Flow 仍由用户按自己的节奏完成，Windows 和 winget 是明确的前置条件；provider 或 dsh 命令发生变化时，需要更新此 skill。
