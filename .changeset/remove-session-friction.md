---
'vouchington-tooling': minor
---

BREAKING: removes the `vouchington-tooling/session-friction` subpath export and its root re-exports (`buildSessionFrictionReport`, `classifyFrictionObservation`, `FRICTION_LOG_MAX_EVENTS`, `normalizeCommandPrefix`, `readFrictionLog`, `recordFriction`, and the `Friction*`, `SessionFriction*`, and observation types), and removes the `friction` input of `composeRetrospective`. Pass `journal: {journalLoader}` instead: `## CI Failures` and `## Sandbox & Permission Audit` are assessed from journal entries alone and `feedbackCoverage.status: 'complete'` is reachable without a friction log. The audit report coverage no longer carries `frictionStatus` or `droppedCount`, and the journal-only status text reads `(journal entries only)`. `isConformingCiFailureBlock`, `JournalEntry`, `JournalLoader`, and `JournalLoadResult` remain exported from the package root.
