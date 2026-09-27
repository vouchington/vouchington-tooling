---
name: pr-description
description: Write a self-contained PR description backed by the final diff.
---

# Pull-request description

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/pr-description/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Use before opening or updating a pull request, or when reviewing PR hand-off quality. Read local
`AGENTS.md`, pull-request template, and issue-linking policy first.

Include enough context for a reviewer with no prior conversation:

- A concise summary of what changed and why.
- The underlying root cause for a fix, not only its visible symptom.
- Validation performed and any intentionally skipped checks with reasons.
- Rollout, compatibility, operational safety, and follow-up context when the change affects a live
  or independently deployed surface.
- Correct issue relationships: close only issues fully resolved and explain any non-closing links.
- A compact diagram only when it materially clarifies a multi-component flow or lifecycle.

Use the repository's approved PR tooling and preserve sections managed by its review automation.

Consumer wrapper owns: required headings, source-issue rule, merge policy, repository command, and
hosted review system.
