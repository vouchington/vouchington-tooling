---
'vouchington-tooling': minor
---

Add the `issue-comment-context` composite action. It snapshots an issue or pull request for an
agent prompt: the body, label names, and the most recent `max-comments` comments (default 100),
each truncated to `max-comment-chars` (default 2000), plus `commentSnapshot` metadata (`total`,
`included`, `capped`, `maxCommentChars`). The JSON is written to `output-path` and returned as the
`context-file` and `context` outputs.
