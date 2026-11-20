# PR creation feedback

Read this when a PR-triage caller supplied agent-authored PR creation feedback this session. Keep
both the per-PR findings and the deduplicated grouped themes.

```markdown
## PR Creation Feedback

### Per-PR findings

- PR #N - `<recurring|one-off>`
  - Evidence: <body, diff, checks, or shepherd correction>
  - Generator provenance: <verified generating prompt or skill>
  - Source target: <exact file path>
  - Recommendation: <specific preventive improvement>

### Grouped themes

- <theme>
  - PRs: #N, #N
  - Recurrence: <recurring|one-off>
  - Source target: <exact file path>
  - Recommendation: <deduplicated improvement>
  - Disposition: <issue #N|PR #N|preauthorized-pr #N|deferred>
```

When there is no actionable feedback, write `No actionable feedback: none` instead of inventing a
theme.

## Disposition

When the caller did not already publish the feedback, ask the user to choose one:

- **File issues:** deduplicate by root cause, file through the repository's issue workflow, and
  record each issue link.
- **Make a PR:** when several unrelated themes exist, ask which single theme to implement. Reuse or
  create its tracking issue, make one coherent draft PR, do not merge it, and record the PR link.
- **Defer:** make no GitHub change; the theme stays eligible for a later distillation run.

When the triage flow already completed its bounded publication
([feedback](../../triage-prs/references/feedback.md)), it passes `Disposition: preauthorized-pr #N`.
Record that exact disposition and the PR link without asking again. If publication failed or only
partly completed, record the concrete blocker as `deferred`; never claim the feedback was handled.

Save one retrospective with the final disposition and links for all PRs.
