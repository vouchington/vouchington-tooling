---
'vouchington-tooling': minor
---

Make the `vouchington-tooling` MCP server the first-class journaling path. The blackboard skill now
has agents restore an unavailable server (register it, reconnect it, or report "journaling
unavailable" in automated runs) before anything else, and marks the `agent-blackboard journal` CLI
fallback as deprecated and being phased out. Agents never request an unsandboxed run only to obtain
`AGENT_BLACKBOARD_TOKEN`.
