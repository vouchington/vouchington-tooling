---
'vouchington-tooling': minor
---

Remove the auto-harness integration, which is retired. The reusable `harness-dispatch` workflow
(`.github/workflows/harness-dispatch.yml`), the `comment-harness-session` composite action, and the
`vouchington harness-assert-gates` CLI command (with its `scripts/gha/harness-assert-gates.sh`
helper) are deleted. This is a breaking change for any caller that still references them; the
package is pre-1.0, so it ships as a minor bump. The unreleased changesets that announced the
workflow and action are dropped with them. `harness-admission-lane` is unchanged.
