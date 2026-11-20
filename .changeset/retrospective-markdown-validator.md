---
'vouchington-tooling': minor
---

`retrospective_save` now validates a hand-written `markdown` retrospective by default, without a
policy module: the required fact headers and markers, the `## CI Failures` grammar (one `Status:`
line, `GitHub Actions` as the only source), `## Tool Findings` and `## Architecture Findings` with
evidence and a disposition per finding, and a `feedbackCoverage` of `complete` over unavailable,
not-assessed or partial sources is rejected. The checks run before the policy's
`validateRetrospective`, which still runs, and `compose` output satisfies them.
