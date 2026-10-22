---
'vouchington-tooling': minor
---

`retrospective-transcript` now reports Codex sandbox escalations: `exec_command` calls whose parsed
arguments request `sandbox_permissions: "require_escalated"`. Each is listed with its normalized
command prefix, justification, and `prefix_rule` under `Sandbox escalations`. Text that merely
mentions the field is ignored. The approval outcome is omitted because the rollout does not record
it in a stable shape.
