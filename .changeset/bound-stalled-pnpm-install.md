---
'vouchington-tooling': patch
---

Bound and retry a stalled `pnpm install` in the `setup-node-pnpm` action. A new `install.mjs`
runs the frozen install with tight fetch settings (`--fetch-timeout=15000` and three retries with
1-5s backoff), kills the process group when an attempt exceeds a wall-clock limit, and retries once
with append-only info logging. The limit and attempt count are the new `install-attempt-timeout-seconds`
(default `150`) and `install-attempts` (default `2`) inputs. A non-timeout failure is not retried.
