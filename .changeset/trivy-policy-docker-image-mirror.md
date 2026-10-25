---
'vouchington-tooling': minor
---

Add `vouchington trivy-policy` and `vouchington docker-image-mirror`, with the `vouchington-tooling/trivy-policy` and `vouchington-tooling/docker-image-mirror` subpaths. Both read `git ls-files -z`, print violations and exit 1. `trivy-policy` checks tracked Trivy scans and the exception registry; the ignore file, findings exit-code variable, cleanup URL prefix, minimum scan counts and maximum expiry are flags. `docker-image-mirror` requires Docker Hub images to come from `--mirror` (default `mirror.gcr.io`).
