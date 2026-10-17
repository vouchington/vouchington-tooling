---
'vouchington-tooling': minor
---

`ghcr-package-retention` gains `--dry-run`, `GHCR_PACKAGES`, and a `--main-history` strategy that prunes `sha-<commit>` images by main-branch history, unmerged age, and orphaned attachments (`--apply`, `GHCR_KEEP_MAIN`, `GHCR_UNMERGED_MIN_AGE_DAYS`, skips missing packages).
