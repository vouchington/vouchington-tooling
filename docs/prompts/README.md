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

To request another provider review after the once-per-PR review completes, remove the
`final-code-review:complete` label. The label workflow rechecks that the current head passed `tests`
before running the providers again and restores the complete label only after the configured gate
succeeds.
