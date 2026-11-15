---
name: pr-description
description: Create, update, and validate pull request descriptions through the vouchington `pr_create`, `pr_update`, and `pr_validate` MCP tools.
---

# Pull-request description

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/pr-description/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

The rules for what a description says (the problem, the change, the impact, before/after evidence,
and how much detail to add) live in the `pr-description` skill from the `jonathanong/skills`
plugin. This skill covers only what depends on the vouchington MCP tools.

Create, update, and validate pull requests through the `pr_create`, `pr_update`, and `pr_validate`
MCP tools with structured input, not by hand-writing a body: pass `title`, `summary`, `impact`,
`relatedIssues` (`closes` or `refs`, each with a reason), `details` (Markdown paragraphs or
bullets), `base`, `agent`, optional `model`, `mode`, and `workspaceSetup`. The server renders the
required headings and provenance lines, runs the repository's policy validation, and blocks on its
errors, so put the description guidance into `summary`, `impact`, and `details`. Run `pr_validate`
first to preview the rendered body.

The Shepherd Journal section belongs to the review automation. `pr_update` preserves the live
Shepherd Journal; never copy, rewrite, or hand-edit it. Leave CI history, rebase narrative, and
local test lists out of the body; the Shepherd Journal and evidence record hold them.

Consumer wrapper owns: required headings, source-issue rule, merge policy, repository command, and
hosted review system.
