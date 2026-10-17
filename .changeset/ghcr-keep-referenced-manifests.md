---
'vouchington-tooling': patch
---

`ghcr-package-retention.sh --main-history` no longer deletes versions that a kept image or index
still references. It reads the kept manifests from the registry, follows `manifests[]` and `subject`
recursively, and skips any deletion whose digest is reachable, so platform manifests and
attestations of a multi-arch index survive. If a kept manifest cannot be read, the run fails
without deleting anything for that package.
