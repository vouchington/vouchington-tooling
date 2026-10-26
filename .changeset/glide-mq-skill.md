---
'vouchington-tooling': minor
---

Add a canonical `glide-mq` skill to the `vouchington-database` plugin: every shared-queue job sets
`ordering`, `ordering.concurrency` is a global cap while the worker `concurrency` is per process,
group FIFO ignores priority so floodable families get their own lanes, a job moved to delayed
keeps its ordering slot so caps that must survive deferral use a token-owned lease released before
`moveToDelayed`, and job count is not a KPI. Bump the `vouchington-database` plugin to 0.9.0.
