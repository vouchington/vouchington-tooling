---
'vouchington-tooling': patch
---

`allocate-browser-safe-ports` now returns ports that are free on both `127.0.0.1` and `::1` and outside the OS ephemeral range, so a later IPv6 loopback listener cannot shadow an allocated port. It degrades to an IPv4-only check with a warning when `::1` is unavailable.
