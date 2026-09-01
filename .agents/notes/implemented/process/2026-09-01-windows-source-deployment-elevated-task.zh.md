# Agent Note: Windows 源码部署以提权方式运行 Web 任务

Status: implemented

[English](2026-09-01-windows-source-deployment-elevated-task.md) | 中文

## Problem

持续运行的 Windows 源码部署通过经过认证的回环 Web 应用提供 Harness shell、文件系统和子进程工具。受限的计划任务令牌会阻止这些工具执行仅限管理员的开发操作，而从提权终端启动整个 setup 还会让包安装、依赖生命周期脚本和构建获得不必要的管理员权限。

## Decision

根 `setup.ps1` 以发起用户的权限安装依赖、构建 checkout 并同步本地 Copilot provider。任务注册是通过 UAC 启动的独立内部阶段。该阶段要求发起 setup 的同一 Windows 账户提供管理员令牌，替换 `DeepSeek Harness Web` 任务，并使用 `RunLevel Highest` 注册其交互式 principal。提权任务是唯一部署模式；重复运行 setup 不会静默降低其权限。

Web 应用继续只监听 `127.0.0.1`，并要求使用其持久化启动 token。这些控制限制访问，但不会降低已认证请求的权限：工具和获准的模型操作使用计划任务的管理员权限执行。

本决策仅部分取代 [Windows 源码部署决策](2026-09-01-windows-source-deployment-task.zh.md)中的任务令牌选择。其登录触发器、重启策略、Node 直接进程所有权、Harness home 选择和 provider 桥接保持不变。

## Alternatives considered

**默认保留受限权限并添加提权开关。** 不采用，因为 Windows 源码部署需要执行仅限管理员的开发操作。两种模式会让一次常规 setup 重跑静默改变已部署工具的权限。

**以提权方式运行完整 setup。** 不采用，因为依赖安装和构建脚本不需要管理员权限。只提升任务注册权限，可以避免这些操作获得对用户正常授权范围之外的写入权限。

**在 Harness runtime 内添加特权 broker。** 不采用，因为该部署需要现有 Windows 进程令牌，而不是新的产品 capability 或授权协议。broker 会把 runtime 和安全模型扩展到 Windows setup 关注点之外。

## Consequences

每次非提权 setup 运行都会在替换计划任务前显示 UAC 提示。发起操作的 Windows 账户必须批准该提示；其他管理员的凭据会导致失败，而不会把任务注册到不同用户下。启动后，经过认证的 Web 应用可以通过其工具产生管理员级别的影响，因此启动 URL 和 token 是此本地部署的管理员凭据。
