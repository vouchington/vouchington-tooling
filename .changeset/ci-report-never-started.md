---
'vouchington-tooling': patch
---

vouchington-workflow 0.28.1: `ci-report` `stale.py` classifies a run that answers 409 to cancel and has no jobs as `never-started`, does not retry it with force-cancel, and prints one summary line (count, oldest age, first ids) saying it cannot be cancelled or deleted through the API and needs GitHub Support. `triage-sweep` Phase G reports that line.

`report.py` now prints a partial report when `--max-calls` runs out after sampling, paginates the jobs of each sampled run, and `ci-report` reports `limit N reached` when a short final page is cut. `stale.py` re-reads each run before its first cancel and leaves it alone if it has since started or finished.
