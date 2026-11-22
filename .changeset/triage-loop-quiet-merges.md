---
'vouchington-tooling': minor
---

vouchington-workflow 0.27.0: the triage loop costs fewer orchestrator calls. `wait.py` runs the
late-review check on every merged PR itself and keeps waiting through clean merges, logging them in
`quietMerges`; it returns only actionable events, merges with findings, completed merge watches, and
due dependency update checks (`pendingUpdateChecks`), with compact one-line events and an optional
`--advance` for the cursor. `state.py` gains `late-review`, `watch add|list|remove`, and
`update-check-script`, and accepts the `watches`, `quietMerges`, and `pendingUpdateChecks` fields.
