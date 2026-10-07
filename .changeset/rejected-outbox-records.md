---
'vouchington-tooling': patch
---

Move permanently rejected blackboard appends (`identity-conflict`, `event-conflict`,
`archived-session`) out of the pending outbox into a rejected area instead of retaining them forever.
A corrected retry with the same `sourceEventId` is now accepted, `outbox_status` and `journal status`
report `rejectedCount` and `worktreeRejectedCount`, and `outbox_flush` and `journal flush` report
moved records as `rejected` with `sourceEventId` and `diagnostic`. Transient failures stay pending.
