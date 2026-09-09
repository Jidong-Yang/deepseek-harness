---
description: "Package map for external control-plane connections to existing DSH Sessions."
kind: "package-group"
---

# integration/ — external control planes

English | [中文](README.zh.md)

## Summary

Integration packages connect external control planes to DSH-owned Sessions. They use existing Session and tool services rather than hosting a second agent runtime.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

IRA Provider is owned and deployed by the separate ira-agent-platform repository. The profile loader accepts it as an external package under the @deepseek-ai/dsh-ira-provider identity.

<a id="related-documentation"></a>
## Related documentation

The [Session subsystem](../../docs/subsystems/session.md) owns SessionController and persistence contracts; the [tools subsystem](../../docs/subsystems/tools.md) owns scoped registration and guarded execution.

<a id="dev-note"></a>
## Dev Note

None.
