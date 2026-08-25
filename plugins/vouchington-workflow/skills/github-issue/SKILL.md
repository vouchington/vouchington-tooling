---
name: github-issue
description: Search, create, update, link, or assess GitHub issues using the repository's live issue policy and taxonomy.
---

# GitHub issues

Use for durable follow-ups and pull-request linkage. Read local `AGENTS.md`, `CLAUDE.md`, issue
templates, and repository-routing policy before making any remote mutation.

1. Confirm GitHub authentication and the explicitly authorized repository. Search open and relevant
   closed issues before creating work; return a likely duplicate rather than filing one.
2. Verify paths and current behavior named in an issue. A discovered blocker does not widen an
   accepted implementation scope without the required local decision.
3. Write a self-contained issue: problem, desired outcome, ownership boundaries, concrete areas,
   validation, and any external dependency. Apply only existing labels and milestones according to
   live local taxonomy.
4. Link a pull request with a closing reference only when it fully resolves the issue. Use a
   non-closing relationship with an explanation when work remains.
5. For updates or closure recommendations, inspect current state and evidence first. Preserve
   history and report the action, URL, and resulting metadata.

This skill does not choose a default repository, permit cross-repository writes, create taxonomy,
or prescribe a CLI wrapper. Consumer wrappers define authorization and local mechanics.
