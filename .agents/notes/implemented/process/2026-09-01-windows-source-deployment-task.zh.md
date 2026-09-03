# Agent Note: Windows 源码部署以幂等计划任务运行

Status: implemented

[English](2026-09-01-windows-source-deployment-task.md) | 中文

## Problem

Windows 源码部署原本依赖一个手动执行依赖安装、构建和 `pnpm dsh web` 的终端。关闭该终端就会停止 Web 应用，用户登录不会恢复它，单独配置的本地 Copilot provider 也可能与 Harness 模型路由发生偏差。认证和 provider 生命周期必须继续留在 Harness 进程之外。

## Decision

根 `setup.ps1` 是显式且幂等的 Windows 源码部署入口。它要求 PowerShell 7、winget 和受支持的 Node.js 版本；通过 `winget install -e --id pnpm.pnpm` 安装或更新 pnpm；运行 `pnpm install --frozen-lockfile`、`pnpm run clean` 和 `pnpm run build`；并注册当前用户的 `DeepSeek Harness Web` Task Scheduler 任务。清理会移除构建产物和已删除 package 的安全残留，避免构建发现过期模块。该任务在交互式登录时启动，忽略重复启动，没有执行时间限制，并在失败后重启；其注册和执行权限由[提权任务决策](2026-09-01-windows-source-deployment-elevated-task.zh.md)规定。Task Scheduler 通过 `scripts/run-windows-web.ts` 直接执行 Node；该入口固定所选 Harness home，并分派与 `pnpm dsh web --no-open` 相同的源码入口和参数。让 Node 成为任务进程后，停止和重启操作持有服务进程，而非只持有 package manager 父进程。

除非传入 `-SkipCopilotBridge`，setup 会调用 `scripts/configure-local-copilot-provider.ts`。桥接要求同级 provider 的安全健康端点报告 `ready`，读取两个实时协议专用模型目录，并且只原子更新 Harness settings 文档中的 `llm-pi-ai.providers.copilot-proxy` 和 `llm-pi-ai.providers.copilot-chat`。它保留无关设置和注释，删除协议目录为空的路由，发布一次有界 Harness 重试，并且只通过计划任务进程环境提供非敏感占位符。GitHub OAuth 和 Copilot session 凭据仍由[本地 provider setup 决策](2026-08-24-local-copilot-provider-setup.zh.md)所述的 provider 进程负责。

## Alternatives considered

**在用户登录前随机器启动。** 不采用，因为源码部署使用当前用户的 Harness home、凭据、浏览器授权状态和可见诊断。交互式登录与这些所有者以及同级 provider 任务一致，无需保存 Windows 密码或虚构 service account。

**安装 Windows service。** 不采用，因为 service 会为开发 checkout 增加另一个可执行程序和 service-account 生命周期。Task Scheduler 已提供登录启动、重启策略、单实例行为、用户交互式令牌和进程所有权。

**把 Copilot 认证构建进 Harness 任务。** 不采用，因为本地 provider 负责 token 存储、刷新、entitlement 检查和上游恢复。桥接只包含端点与目录配置。

**把 Copilot 路由放入随产品交付的 profile。** 不采用，因为同级 checkout 和未公开的推理 API 是本机部署选择。显式 setup 可以把路由发布到所选 Harness home；普通 profile 继续保持 provider-neutral。

## Consequences

一条命令即可收敛 Windows checkout、桥接配置和长期运行的 Web 进程，下一次交互式登录会恢复应用且不打开浏览器。重复运行 setup 会更新依赖、重新构建、重新同步目录、替换任务定义并启动新进程。如果 Copilot provider 缺失或不健康，默认 setup 会在构建后失败，而不是发布过期或虚构的模型；`-SkipCopilotBridge` 让 Harness 部署继续保持独立。该任务不会 pull 或重写任何 Git worktree，源码更新只有在 setup 重新构建并重启后才生效。
