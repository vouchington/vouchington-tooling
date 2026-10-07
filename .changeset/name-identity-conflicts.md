---
'vouchington-tooling': patch
---

Name each differing session identity field, with its stored and supplied values, in
`identity-conflict` errors from the MCP server and the journal CLI. A version-only mismatch no
longer conflicts: the entry is delivered into the existing session and the result reports
`storedVersion`. A different parent or agent still conflicts.
