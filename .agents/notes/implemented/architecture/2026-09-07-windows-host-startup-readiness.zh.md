# Agent Note: Windows Host 启动就绪

Status: implemented

[English](2026-09-07-windows-host-startup-readiness.md) | 中文

## Problem

Windows 监督进程需要确认其 Host 启动尝试已完成，且不能解析输出、依赖 Hub 连接或接受其他进程的监听端口。提前正常关闭后，模块导入仍可能结束，因此仅凭导入完成无法确认启动成功。

## Decision

Windows 运行器在获取 Host 环境快照之前读取并移除可选的、仅属于本次尝试的文件路径与 nonce。CLI（命令行界面）提供现有 `AppReady` 句柄和受限的本地认证 URL getter（读取函数），不导出 Host context。运行器在导入后订阅，且只在启动器持有的状态提交后发布记录。[CLI 参考](../../../../apps/cli/reference/README.zh.md#windows-supervisor-startup-record)定义输入、JSON 字段和文件系统要求。不引入新的插件、profile、遥测事件或就绪状态持有者。

发布器先独占创建并刷写临时文件，再为尚不存在的目标创建硬链接。硬链接创建操作提供原子可见性，不会覆盖竞争创建的文件或链接。调用方负责私有、稳定的尝试目录；祖先目录检查不能防御管理员并发替换该目录。

浏览器认证 URL 通过可选的、绑定 nonce 的当前用户管道交接，而不是写入就绪文件或通用 stdout。发送器在 AppReady 发布后只发送一次，并限制数据量与期限；失败时不回显凭据。这样本地监督控制台可以提供可用入口，而不保留 Host/Session 输出，也不把凭据放入运维报告。

## Alternatives considered

**导入结束或 HTTP 成功后发布。** 不采用，因为已 dispose（资源释放）的配置树仍可能正常返回，HTTP 载体也可能在其他条目激活及启动器设置完成前开始监听。

**使用打印的 Web URL 或 Hub 心跳。** 不采用，因为输出可能包含凭据，且不是机器可读的启动记录；Hub 的可用性描述另一个组件。[浏览器交接决策](../feature/2026-08-12-open-ready-web-ui.zh.md)保持独立且不变。

**重命名并覆盖最终路径。** 不采用，因为替换语义可能覆盖已有或竞争创建的目标。同目录硬链接要求本地文件系统支持，但能原子地拒绝替换。

## Consequences

可选变量缺失时保持常规启动行为。验证和发布失败输出不含输入值的静态诊断。监督进程仍负责进程/Job 存活判断、nonce 验证、期限和保留策略；启动记录不是健康租约，也不授予基于 PID 的终止权限。非致命 MCP 失败仍遵循插件启动语义，而不是另一套就绪策略。

验证通过一次性 profile fixture（测试前置数据）运行真实 Windows 运行器，覆盖延迟激活、失败和提前 dispose、提交后的订阅、从 Host 快照和子进程环境中移除请求，以及拒绝覆盖的发布失败。不涉及真实 home、浏览器监听器、Hub、Session 或生产任务。
