---
'vouchington-tooling': major
---

Delete the workflow skills that now live in the `jonathanong/skills` plugin. This removes
published `skills/` export paths, so consumers that read them from
`node_modules/vouchington-tooling/skills/` must switch to the upstream plugin.

- `vouchington-workflow` 0.23.0 drops `agent-workflow` (with its `references/`),
  `git-commit-checklist`, `github-issue`, `planning`, `review-ci-logs`, `revisit-followups`, and
  `github-actions-checklist`. Use the upstream skills of the same names; the Actions checklist is
  now the `github-actions-authoring` workflow baseline.
- The hand-off retrospective and merge-note rules moved into `retrospective`. The project and plan
  issue milestone rules moved into `organize-github-issues`, and `review-github-issue-taxonomy`
  links there. The stop-condition rule moved into the retrospective issue-body template, and the
  `follow-up` label requirement into `triage-sweep`.
