---
'vouchington-tooling': patch
---

The reusable `cancel-replaced-merge-group-runs` and `cancel-dequeued-merge-group-runs` workflows now
treat a failed or empty runs listing as a warning and skip that status, instead of failing the job
when the GitHub API returns a transient error such as HTTP 502. The dequeued workflow also cancels
nothing, with a warning, when it cannot read the pull request's merge state. Both tolerate null
`workflow_runs` and `jobs` bodies. Cancel and jobs-read failures still fail the job.
