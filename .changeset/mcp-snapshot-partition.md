---
'vouchington-tooling': minor
---

Add the `snapshot_partition` MCP tool, which partitions a `snapshot_export` file from the same server-minted `cleanupToken`. The server resolves the export path and the blackboard client's own capability itself and runs the client's `partitionSnapshot` in-process, so it works with the registry token and under a sandbox `TMPDIR`. The partition directory is recorded, so `snapshot_cleanup` now removes the snapshot and its partitions together. The `retrospective-distill` skill calls the tool instead of the CLI (`vouchington-workflow` 0.14.3).
