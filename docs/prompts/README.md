# Code review prompts

The automatic final-review workflow composes two trusted Markdown files:

- `code-review.md` defines what the reviewer inspects and which findings are actionable.
- `code-review-inline-comments.md` defines the bounded JSON handoff and requires every finding to
  remain an inline comment.

The workflow reads both files from the pull request's base commit, so a proposed prompt change does
not control the review of its own pull request. Reusable action callers may keep their repository's
base prompt at `.agents/skills/agent-workflow/code-review-prompt.md` or pass another trusted relative
path explicitly.

Provider models and enablement flags are organization Actions variables. Prompt paths, trust
boundaries, payload limits, tool permissions, and installer digests remain version-controlled
security policy rather than mutable organization settings.

The trusted default-branch `workflow_run` router validates one exact completed CI attempt and emits
a correlated `repository_dispatch`. That dispatch selects the immutable pull request head and base
before provider work begins. Provider jobs remain read-only; only trusted poster jobs can write
review comments, and they revalidate that the pull request is still open and ready at the write
boundary.

The ruleset-facing `Code Reviewed` check is published directly on the selected pull request head.
Its selector accepts only a successful `tests` job from the exact `ci.yml` run attempt, head SHA,
base SHA, event, and pull request. Fork and bot PRs receive the same selected-head check without
provider secrets or a provider checkout.
The [main-branch ruleset](https://github.com/vouchington/vouchington-tooling/rules/21224701) pins both
`tests` and `Code Reviewed` to the GitHub Actions integration.

Each successful CI completion creates at most one correlated review attempt for its exact head.
Marking a draft ready produces a fresh CI completion; converting to draft or closing runs a trusted
lifecycle workflow in the same concurrency group, canceling provider work and clearing review
state. Provider and poster failures remain advisory; orchestration, settings, exact-test
provenance, live-head failures, and lifecycle writes remain blocking. Label jobs grant both
`issues: write` and `pull-requests: write`.
