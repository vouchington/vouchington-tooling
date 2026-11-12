---
'vouchington-tooling': patch
---

`fetch-base-ref` bounds each `git fetch` attempt with a 45 second timeout and retries up to 3 attempts with a short backoff, then fails with an error that names the ref.
