---
'vouchington-tooling': patch
---

Pin `harness-dispatch` to `jonathanong/auto-harness/actions/dispatch` v1.0.2. It retries a 408 or
429 once, and a 5xx, timeout or network error once, because the workflow always passes
`concurrency-id`. It also writes the step summary and session notice itself, so the workflow's own
`Summarize session` step is removed.
