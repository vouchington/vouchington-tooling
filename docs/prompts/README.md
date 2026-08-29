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

The trusted default-branch `pull_request_target` workflow owns orchestration and the narrow review
comment write boundary. Provider jobs remain read-only; only trusted poster jobs can write review
comments.

The ruleset-facing context is the native `Final Code Review / Code Reviewed` job created for every
pull request head. Its selector accepts only a successful `tests` job from the exact `ci.yml` run,
head SHA, event, and pull request. Fork and bot PRs use that same native job after tests, without
provider secrets or a provider checkout.
The [main-branch ruleset](https://github.com/vouchington/vouchington-tooling/rules/21224701) pins both
`tests` and `Code Reviewed` to the GitHub Actions integration.

Each new commit creates another native gate and review attempt. Opening, reopening, synchronizing,
converting to draft, closing, or marking a draft ready retriggers the default-branch workflow.
Provider and poster failures remain advisory; orchestration, settings, exact-test provenance,
live-head failures, and completion-label writes remain blocking. Label jobs grant both
`issues: write` and `pull-requests: write`.
