---
'vouchington-tooling': patch
---

`navigateTo` no longer retries a `page.goto` timeout (retry only on real connection errors such as `ERR_CONNECTION_REFUSED`/`RESET`), so a slow but live server can finish its load instead of being aborted and restarted. It also waits for `load` plus the hydration probe instead of `networkidle`, which could hang on background requests; the `waitUntil` option now accepts only `'load'`.
