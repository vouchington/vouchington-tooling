---
'vouchington-tooling': minor
---

Make `setup-node-pnpm` fail fast on runner network stalls: `pnpm install` now makes up to 3 attempts of 80s each (`install-attempts` default `3`, `install-attempt-timeout-seconds` default `80`) with a 5s backoff, and the pnpm download makes up to 3 attempts of 30s each with a 3s backoff, all inside the unchanged 270s total deadline. Only a per-attempt timeout or a network/registry error (`ERR_PNPM_META_FETCH_FAIL`, `ETIMEDOUT`, `ECONNRESET`, ...) is retried, and each retry is logged with its reason. A lockfile mismatch, a 404, or any other failure fails at once.
