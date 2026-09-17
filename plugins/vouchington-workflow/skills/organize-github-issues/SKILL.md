---
name: organize-github-issues
description: Organize existing GitHub issues and pull requests with the repository's live taxonomy without inventing new taxonomy.
---

# Organize GitHub issues

Use for issue hygiene, priority normalization, milestone assignment, and project membership. Read
local `AGENTS.md`, `CLAUDE.md`, and live taxonomy guidance before acting.

1. Confirm repository identity and fetch the live labels, milestone descriptions, open project
   descriptions, and all required in-scope issue or pull-request evidence. Before mutating, enforce
   the operation-specific gate from [github-issue](../github-issue/SKILL.md); pull-request metadata
   does not require issues to be enabled.
2. Classify from the permitted metadata and discussion evidence, not implementation guesses. Keep
   automation, ownership, and provenance labels unless local policy explicitly permits changes.
3. Apply only existing labels, milestones, and projects without requesting separate label approval;
   an issue belongs to at most one project, and not every issue needs one. Before adding a project,
   check the issue's current membership and skip the add, reporting the conflict, instead of creating
   a second one. Never set a project item's status to a value that closes the issue unless the caller
   separately authorizes closing it. Do not create taxonomy, close work, rewrite bodies, or alter
   titles unless the caller separately authorizes that scope.
4. In review mode, report the exact proposed metadata changes without mutating. In apply mode, make
   only necessary, idempotent updates.
5. Refetch every touched item and verify the requested metadata, including project membership,
   changed while protected metadata stayed intact. When an item was added to a project, report any
   additional item the project's own automation pulled in, such as a parent issue's sub-issues,
   rather than assuming only the requested item changed. Report changed, unchanged, and ambiguous
   items separately.

This skill does not define priorities, labels, milestones, projects, clarification policy, or
default scope. A consumer wrapper supplies the repository-specific taxonomy and permissions.
