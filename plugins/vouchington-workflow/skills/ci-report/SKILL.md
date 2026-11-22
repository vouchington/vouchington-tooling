---
name: ci-report
description: Summarize a repository's CI health (timings, queue waits, slow jobs, failures, flakes, runner minutes) and cancel workflow runs stuck in queued or in_progress, with bundled scripts that replace hand-built gh run loops.
---

# CI report

Read applicable `AGENTS.md` in the repository first; its policy overrides these defaults. A consumer
wrapper may add repository-specific thresholds but does not widen what `stale.py` cancels.

Two stdlib Python scripts that need `gh` and Python 3. Both print compact one-line rows, paginate at
100, and cap their API calls (`--max-calls`), listing whatever the cap cut under `truncated`. Run
them instead of looping over `gh run list` and `actions/runs/<id>/jobs` by hand.

## Report

```bash
python3 <this skill>/scripts/report.py --repo owner/name [--days 7] \
  [--events merge_group,pull_request,push] [--max-runs 300] [--jobs-sample 40] [--json]
```

Rows, in order: `wf` (per workflow and event: count, wall-clock p50/p90/max, queue wait p50/p90,
conclusions, cancelled share), `job` (per workflow, job, and runner label: median, max, total
minutes, failures), `runner` (minutes by label with the billing multiplier: Linux 1x, Windows 2x,
macOS 10x), `fail` (job plus failed step, with counts and up to 3 run ids), `eject` (failing
`merge_group` runs mapped to their PR by the `gh-readonly-queue/<base>/pr-<N>-...` ref),
`rerun-success` (`run_attempt > 1` that succeeded: a flake signal), `required` (required checks from
the default branch's rules), `draft-vs-ready` (pull request runs by the PR's current draft state),
and `rate` (core and graphql remaining, before and after). `--json` prints the full structure.

Limits to know when reading it: `--max-runs` is split evenly across `--events`; job rows come from a
sample of runs (failed runs first, up to half, then the newest completed), so job totals describe
the sample, not the window; wall-clock is the latest attempt's `updated_at` minus `run_started_at`;
skipped jobs have null timestamps and are counted but excluded from timings.

## Stale runs

```bash
python3 <this skill>/scripts/stale.py --repo owner/name [--older-than 6h] \
  [--status queued,in_progress,waiting,pending] [--dry-run]
```

Runs stuck in those statuses longer than `--older-than` (default `6h`, minimum `1h`, units `m`, `h`,
`d`; age is time since creation, or since start for `in_progress`) are cancelled with
`POST actions/runs/<id>/cancel`. `force-cancel` is used only when cancel answers 409 and a re-read
shows the run still stuck. Runs younger than the threshold are never listed or touched. `--dry-run`
only lists. One line per run: id, workflow, event, PR or branch, status, age, result.

A run that answers 409 to `cancel` and has no jobs (`GET actions/runs/<id>/jobs` is empty) never
started: GitHub refuses `cancel`, `force-cancel`, and `DELETE` for it (403). `stale.py` does not
retry it and prints no per-run line; it prints one summary line instead, for example
`never-started n=54 oldest=10.5d ids=1,2,3,4,5,... (cannot be cancelled or deleted via the API; ask
GitHub Support)`. It is not a failure: report it, and ask GitHub Support to remove those runs.

Cancelling is not reversible: pass `--dry-run` first unless the caller has asked for cancellation.
Waiting runs can be legitimate environment approvals; narrow `--status` when that applies.
