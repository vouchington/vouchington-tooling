---
'vouchington-tooling': patch
---

The packaged `blackboard` skill now names friction as the primary journaling focus (failed checks,
denied permissions, scope changes, repeated fixes, and reusable tool gaps) and keeps broader
consequential observations as allowed but secondary. Bumps the `vouchington-workflow` plugin to
0.14.1 so consumers can delete their narrowing override.

`retrospective-distill` also drops the stale `inactiveForHours` reason for exporting unfiltered:
the cutoffs decide eligibility and too-new sessions are reported as skipped with a reason.
