---
'vouchington-tooling': patch
---

The `vouchington mcp` server now returns an actionable error when its Node binary was removed (for example by a Node version upgrade) instead of a raw `spawn ... ENOENT`, telling the user to reconnect the server.
