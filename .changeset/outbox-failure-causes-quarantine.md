---
'vouchington-tooling': minor
---

Surface why outbox delivery fails and stop one stuck record from blocking distillation.
`outbox_flush` and `outbox_status` report `failures` with a non-secret `cause` (`network`,
`http-5xx`, `http-4xx`, `missing-env:<NAME>`, and similar), optional `httpStatus` and `code`,
`attempts`, and `sourceEventId`; the `blackboard-unavailable` diagnostic stays as the summary.
`.rejected` records now store their diagnostic, and the new `outbox_prune_rejected` tool deletes
old rejections. A record that fails on the same record-specific, non-transient cause on 5
consecutive flushes is quarantined into the rejected area as `delivery-quarantined` and no longer
counts as pending; network errors, timeouts, 5xx, and environment faults never quarantine. The
retrospective-distill skill notes that quarantined records appear as rejections.
