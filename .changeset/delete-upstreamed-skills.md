---
'vouchington-tooling': major
---

Delete the skills that now live in the `jonathanong/skills` plugin. This removes published
`skills/` export paths, so consumers that read them from `node_modules/vouchington-tooling/skills/`
must switch to the upstream plugin.

- The `security-triage`, `vouchington-testing`, and `vouchington-database` plugins are removed.
  Their skills (`triage-codex-security`, `bounded-iteration`, `glide-mq`,
  `postgres-node-performance-tuning`, `postgres-partitioning-uuid-v7`, `postgres-schema-design`,
  `test-authoring`, `playwright-authoring`, and the Vitest, backend, Next.js, Storybook, Swift, and
  .NET test skills) are upstream; the runner skills are now `test-authoring` references.
- `vouchington-workflow` 0.22.0 drops `dependabot`, `github-actions-authoring`, `npm-publishing`,
  `package-json-checklist`, `static-analysis-checklist`, and `stacked-prs`. Use the `pr-shepherd`
  skill (`pr-shepherd:pr-shepherd`) for stacked pull requests; the loop-specific stack rules moved
  into `triage-loop`.
- `pr-description` keeps only the `pr_create`, `pr_update`, and `pr_validate` MCP guidance and
  Shepherd Journal handling, and points to the upstream `pr-description` skill for the generic
  rules. Its `references/examples.md` is removed.
