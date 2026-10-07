---
name: agent-workflow
description: Implement and review repository changes within local policy.
---

# Agent workflow

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/agent-workflow/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Use before implementation. Inspect checkout status without discarding work; follow local branch,
worktree, contribution, and CI policy. Read every applicable `AGENTS.md` from the repository root
through changed files, plus relevant documentation and tests. Local instructions govern this skill.

Use [PR descriptions](../pr-description/SKILL.md) before creating or updating a pull request.
Diagnose failed CI with [CI-log review](../review-ci-logs/SKILL.md), then update confirmed harness
gaps before handoff. Keep those records after checks pass; routine local successes stay in the
evidence record.

- During implementation, use [implementation](references/implementation.md).
- Before handoff, use [evidence sweep](references/evidence-sweep.md).
- For review, use [review](references/review.md).
- For surfaced feedback, use [review response](references/review-response.md).

Load only the references required by the current phase. Keep scope changes explicit; a discovered
blocker or follow-up does not authorize widening the task.

## Parallel by default

Split work into independent units and run them concurrently, one worker and worktree each, within
any cap the human set. Dispatching to a peer session in another repository is a unit.

Serialize only on a named dependency:

- A consumer change needs an upstream API or fix that is not yet released.
- Units change the same files or contract. Stack them instead of waiting.
- Units would write in the same worktree.

For upstream work, open every independent pull request at once, shepherd them concurrently, merge
the ready set together, and cut one release. Start each consumer adoption once an admitted release
contains what it needs; start consumer work that does not need the unreleased change now. A ready,
queued, or shepherding pull request does not pause other units.

Consumer wrapper or local instructions own: default branch, runner class, documentation root,
review system, merge policy, and command catalog.
