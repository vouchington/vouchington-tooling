---
name: agent-workflow
description: 'Shared workflow guidance for repository implementation: inspect local instructions, keep changes bounded, validate, and prepare reviewable commits.'
---

# Agent workflow

Use this skill before implementation work. It supplies portable defaults; the repository's
`AGENTS.md`, `CLAUDE.md`, contribution guide, and CI configuration define the actual commands,
branching, review, and release policy.

1. Inspect the current checkout and its status without discarding local work. Follow the consumer
   repository's instructions for branch and worktree topology; do not create either implicitly.
2. Read every applicable `AGENTS.md` and `CLAUDE.md` from the repository root through each changed
   file, then relevant documentation and tests. Apply the closest instruction only when rules
   conflict, and treat all applicable local instructions as higher priority than this skill.
3. Confirm the accepted task's boundary. Reuse existing ownership and utilities; ask before
   widening scope or making an irreversible external change.
4. Write a focused test first when behavior can be tested. Keep source, tests, docs, and generated
   artifacts within the repository's stated size and formatting rules.
5. Run the focused checks, then the local commands required for the changed surface. Report skipped
   checks with a concrete reason.
6. Review the diff for accidental files, secrets, generated output, broken documentation links,
   and assumptions that belong in local instructions instead.

For portable implementation and review checks, read
[implementation and review](references/implementation-and-review.md). Local instructions remain
authoritative for commands, commits, review systems, and release policy.

Do not invent a default branch, runner class, documentation root, review system, merge policy, or
command catalog. A consumer wrapper or local instruction file owns those choices.
