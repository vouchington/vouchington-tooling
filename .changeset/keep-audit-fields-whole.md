---
'vouchington-tooling': patch
---

Stop truncating retrospective CI-failure and sandbox-audit fields to 120 characters, which cut run
URLs and commit SHAs mid-value and left trailing whitespace that failed retrospective validation.
