---
'vouchington-tooling': minor
---

Add a `status` input to the `comment-harness-session` action. `started` (the default) keeps the
idempotent session-link comment. `failed` and `cancelled` post a failure comment built from the new
`headline`, `details`, `run-label`, `run-url`, `session-label` and `closing` inputs, with the run URL
and the session id. The session id and `session-url` are now optional inputs, still required for
`started`. Callers revalidate the source before posting.
