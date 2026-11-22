---
'vouchington-tooling': minor
---

Add batch issue preflight to `vouchington-tooling/agent-issue-labels`: `parseManifest`,
`executePreflight`, `summarizePreflight`, `executeBatch`, `parseBatchArgs`, and `runBatchCli`. The
fail-closed preflight validates a manifest of planned issues against the live label and milestone
taxonomy, path-derived labels, body files, existing duplicates, and intra-batch title collisions.
The permitted `owner/name` repositories (`allowedRepos`) and the labeler config path (default
`.github/labeler.yml`) are caller-supplied parameters.
