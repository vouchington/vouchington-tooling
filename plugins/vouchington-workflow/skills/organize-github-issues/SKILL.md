---
name: organize-github-issues
description: Organize existing GitHub issues and pull requests with the repository's live taxonomy without inventing new taxonomy.
---

# Organize GitHub issues

Use for issue hygiene, priority normalization, and milestone assignment. Read local `AGENTS.md`,
`CLAUDE.md`, and live taxonomy guidance before acting.

1. Confirm repository identity and fetch the live labels, milestone descriptions, and all required
   in-scope issue or pull-request evidence. Before mutating, enforce the repository gate from
   [github-issue](../github-issue/SKILL.md).
2. Classify from the permitted metadata and discussion evidence, not implementation guesses. Keep
   automation, ownership, and provenance labels unless local policy explicitly permits changes.
3. Apply only existing labels and milestones without requesting separate label approval. Do not
   create taxonomy, close work, rewrite bodies, or alter titles unless the caller separately
   authorizes that scope.
4. In review mode, report the exact proposed metadata changes without mutating. In apply mode, make
   only necessary, idempotent updates.
5. Refetch every touched item and verify the requested metadata changed while protected metadata
   stayed intact. Report changed, unchanged, and ambiguous items separately.

This skill does not define priorities, labels, milestones, clarification policy, or default scope.
A consumer wrapper supplies the repository-specific taxonomy and permissions.
