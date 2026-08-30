---
name: pr-description
description: Draft or review a self-contained pull-request description with summary, root cause, validation, rollout, and issue context.
---

# Pull-request description

Use before opening or updating a pull request, or when reviewing PR hand-off quality. Read local
repository-local instructions, pull-request template, and issue-linking policy first.

Include enough context for a reviewer with no prior conversation:

- A concise summary of what changed and why.
- The underlying root cause for a fix, not only its visible symptom.
- Validation performed and any intentionally skipped checks with reasons.
- Rollout, compatibility, operational safety, and follow-up context when the change affects a live
  or independently deployed surface.
- Correct issue relationships: close only issues fully resolved and explain any non-closing links.
- A compact diagram only when it materially clarifies a multi-component flow or lifecycle.

Use the repository's approved PR tooling and preserve sections managed by its review automation.
Do not invent required headings, a source issue rule, merge policy, repository command, or hosted
review system. Consumer wrappers own those mechanics.
