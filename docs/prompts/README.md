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

The default-branch request workflow owns the narrow write boundary for PR labels and final-workflow
dispatch. Provider jobs remain read-only; only trusted poster jobs can write review comments.

The request and completion jobs use `pull-requests: write` for label transitions. GitHub rejects
those pull-request label mutations when the workflow token has only `issues: write`, even though the
labels API is exposed under the issues endpoint.

The ruleset-facing `Code Reviewed` context is an explicit check attached to the exact head SHA
selected at `select-final-review` time and revalidated before publishing. For trusted same-repository
PRs, the `final-code-review` job that publishes it has a different display name, so only the explicit
GitHub-Actions-owned check satisfies the context. Fork and bot PRs instead receive a mutually
exclusive `Code Reviewed` pass-through job from CI after tests, without access to review secrets.

To request another provider review after the initial review completes, remove the
`final-code-review:complete` label. The `final-code-review` workflow rechecks that the exact head SHA
still has a successful `tests` fan-in before running the providers again and restores the
`final-code-review:complete` label only after the `Code Reviewed` gate, including any required
providers, succeeds.
