---
'vouchington-tooling': minor
---

Add `vouchington runner-policy` and the `vouchington-tooling/runner-policy` library subpath: a
config-driven check of GitHub Actions runner policy (allowed labels with matrix resolution,
reusable-workflow delegates, required jobs, exact label job sets and restricted-label rules) that
fails closed on empty discovery, a missing root, parse errors and config entries naming missing
workflows. The label names and job lists live entirely in the consumer's config.
