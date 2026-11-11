---
'vouchington-tooling': major
---

Remove the CI-based code review. The `code-review` reusable workflow, the `code-review` and
`code-review-poster` composite actions, the `vouchington post-review`,
`vouchington stage-review-payload` and `vouchington materialize-pr-context` CLI commands, and the
`vouchington-tooling/gha-post-review`, `vouchington-tooling/gha-claude-post-review` and
`vouchington-tooling/gha-check-run` subpath exports are gone, along with the root-export
`runPostReview`, `runPostReviewCli`, `postReviewWithTokenFromEnv`, `PostReviewError`, `requireEnv`,
Claude App token helpers, and `readRegularReviewPayload`, `stageReviewPayload`,
`writeStagedOutput` and `PayloadRequirement`. Local review stays in `vouchington final-review`;
`vouchington-tooling/gha-review-payload` keeps its parsing, diff-indexing and remap APIs.
