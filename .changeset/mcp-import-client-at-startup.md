---
'vouchington-tooling': patch
---

`vouchington mcp` now imports the `agent-blackboard` client once at startup and reuses it for every
tool call, so deleting the install directory (for example an npx cache eviction) after the server
has started no longer breaks it.
