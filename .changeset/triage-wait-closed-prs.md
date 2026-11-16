---
'vouchington-tooling': minor
---

vouchington-workflow 0.25.0: the triage loop's `wait.py` also subscribes to every closed pull
request in the configured repositories and prints whether each merged, and `triage-loop` drops its
records for a tracked PR once it closes, so merged or closed PRs stop showing as awaiting approval.
