---
'vouchington-tooling': patch
---

vouchington-workflow 0.28.1: `ci-report` `stale.py` classifies a run that answers 409 to cancel and has no jobs as `never-started`, does not retry it with force-cancel, and prints one summary line (count, oldest age, first ids) saying it cannot be cancelled or deleted through the API and needs GitHub Support. `triage-sweep` Phase G reports that line.
