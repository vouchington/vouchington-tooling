---
'vouchington-tooling': patch
---

Add a parallel-by-default rule to the `agent-workflow` skill and have `planning` record which steps
run concurrently and which dependency serializes the rest.
