---
'vouchington-tooling': minor
---

Add `triage-loop`, `triage-sweep`, and a generic `ready-and-shepherd` to the `vouchington-workflow`
plugin (now 0.15.0).

- `triage-loop` starts a standing, self-paced triage session across an organization's
  repositories. It runs on a fallback cron and accepts on-demand intake from users and other
  agents. Its merge authority is scoped to dependency-bot PRs and automation-labeled PRs.
- `triage-sweep` is one pass of that loop. It covers dependency-bot PRs (with judgment for major
  bumps), automation PRs (through `triage-prs` with a no-business-behavior gate), the agent intake
  queue, issue milestone triage, retrospective distillation, and post-merge review comments.
  Escalations get a label, a comment, and a notification.
- `ready-and-shepherd` is extracted from vouchington/vouchington. Adds a `local` shepherd mode for
  repositories without a CI shepherd workflow.
