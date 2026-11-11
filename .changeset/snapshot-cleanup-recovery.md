---
'vouchington-tooling': minor
---

`snapshot_cleanup` accepts `recoveryDirectory` after a server restart: it removes a partition
directory and its source snapshot only when the signed receipt inside proves this server generated
it for the caller's `sessionId` and `worktree` (newly signed receipts carry that owner). Rejections
share one message and recovery is single use. A removed launch worktree now fails with an error that
names it and asks for an explicit `worktree`.
