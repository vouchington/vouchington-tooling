---
'vouchington-tooling': patch
---

vouchington-workflow 0.29.0: the `ci-report` skill and its `report.py`, `stale.py`, `ghlib.py` and `extras.py` scripts are removed. They now live in the jong-skills `github-ci-operations` skill, which accepts the same flags. `triage-sweep` Phase G runs that skill's `stale.py` and reports its `never-started` and `default-branch` summary lines as is; it never cancels default-branch runs.
