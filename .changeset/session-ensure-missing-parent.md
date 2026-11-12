---
'vouchington-tooling': patch
---

The `vouchington mcp` server's `session_ensure` now says that the parent session does not exist on the blackboard when the server answers `parent_not_found`, instead of a bare `POST /sessions -> 404`, and its description tells child sessions to pass their orchestrator's session id as `parentSessionId`.
