---
'vouchington-tooling': minor
---

vouchington-workflow 0.26.0: the triage loop runs the Phase F late-review check for a PR as soon as
the wait reports it merged, tracked or not, without advancing Phase F's cursors, and stays quiet for
events that need no action (an untracked merge with no findings, a closed PR it does not track).
