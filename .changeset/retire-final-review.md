---
'vouchington-tooling': major
---

**Breaking:** the `vouchington final-review` command (`post`, `diff`, `revoke`, `status`, `bench`,
`bench-verifier`), its library code, and the `benchmarks/final-review` eval cases are removed. The
final reviewer now lives in `vouchington/vouchington-reviewer` as a standing `final-reviewer`
session; use `vouchington-reviewer` from a clone of that repository instead.

The `final-review` skill is removed from the `vouchington-workflow` plugin (0.20.0). The
`triage-loop`, `triage-sweep`, and `triage-prs` skills now request a review with the
`final-review:requested` label (or a message to the `final-reviewer` session) and arm, re-enqueue,
or merge a PR only when `vouchington-reviewer status --repo <owner/name> --pr <N>` exits 0. The
`gha-review-payload` and `gh-cli` subpaths stay.
