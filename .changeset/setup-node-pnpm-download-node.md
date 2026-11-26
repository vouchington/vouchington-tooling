---
'vouchington-tooling': patch
---

Stop a stalled Node.js download from holding `setup-node-pnpm` for the ~300s `actions/setup-node`
timeout. A new step puts the requested Node.js release in the runner toolcache first, skipping
the download when the toolcache already has the version, using the same idle timeout, attempt cap,
backoff and shared deadline as the pnpm download and verifying the tarball against nodejs.org's
`SHASUMS256.txt`; `actions/setup-node` then finds it and downloads nothing. A version file that is
not a plain version number is still left to `actions/setup-node`. The action description now says
the install waits a fixed 5s between attempts while the downloads grow it.
