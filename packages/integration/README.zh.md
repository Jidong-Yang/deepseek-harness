---
description: "将外部控制平面连接到既有 DSH Session 的包导航。"
kind: "package-group"
---

# integration/ — 外部控制平面

[English](README.md) | 中文

## 概述

Integration 包将外部控制平面连接到 DSH 拥有的 Session，复用现有 Session 与工具服务，不托管第二套 agent runtime。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

IRA Provider 由独立的 ira-agent-platform 仓库维护和部署。profile loader 以 @deepseek-ai/dsh-ira-provider 标识加载这个外部包。

<a id="related-documentation"></a>
## 相关文档

[Session 子系统](../../docs/subsystems/session.zh.md) 拥有 SessionController 和持久化契约；[工具子系统](../../docs/subsystems/tools.zh.md) 拥有 scoped 注册与执行 guard。

<a id="dev-note"></a>
## 开发备注

无。
