---
'vouchington-tooling': minor
---

vouchington-workflow 0.28.0: a new `ci-report` skill ships `scripts/report.py` (workflow and job
timings, queue waits, runner minutes with billing multipliers, failure signatures, merge-queue
ejections, rerun-then-success flakes, required checks, and rate limits in compact rows) and
`scripts/stale.py` (cancels runs stuck in queued, in_progress, waiting, or pending past a 6h
threshold; `--dry-run` only lists). `triage-sweep` Phase G runs the stale check every full sweep,
controlled by the optional `staleRuns` configuration key.
