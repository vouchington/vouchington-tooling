---
'vouchington-tooling': patch
---

Publish a dedicated GitHub check run for the Claude and OpenCode code-review reusable workflows instead of relying on job success alone, so a reviewer that 404s, rate-limits, or times out surfaces a failed/neutral check ("Code Review failed — the review agent did not complete successfully") rather than silently leaving no check at all. Adds the `gha-check-run` package (`create`/`complete` CLI backed by the GitHub Checks API), wires `head_sha`/`check_run_id` through `code-review`, `opencode-code-review`, and `code-review-poster` composite actions, and grants the calling workflows `checks: write`.
