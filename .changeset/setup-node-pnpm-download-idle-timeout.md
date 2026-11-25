---
'vouchington-tooling': patch
---

Stop a transient npm registry slowdown from failing `setup-node-pnpm`. The pnpm download attempt
was cut off by a flat 30s wall-clock timeout that covered both requests and the whole ~30 MB
tarball, with a fixed 3s backoff, so a slow or briefly stalled registry failed all three attempts
in about 96s. Each attempt now aborts after 15s without a byte (a stall) or 60s in all, the
backoff grows to 5s then 10s, and the failure line says which limit was hit. The one total
`deadline-seconds` still bounds the download and the install together, and the attempt count
stays at 3.
