---
'vouchington-tooling': minor
---

Add `listenOnLoopbackEphemeralPort` to `vouchington-tooling/runner-port-policy`. It binds an
unreserved ephemeral port on `::1` and falls back to `127.0.0.1` only on `EAFNOSUPPORT`,
resolving `{ host, port }` and reusing the existing bind-retry loop and `EphemeralListenerOptions`.
