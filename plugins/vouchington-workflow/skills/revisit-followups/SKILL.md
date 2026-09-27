---
name: revisit-followups
description: Find verified deferred work in completed changes and instructions.
---

# Revisit follow-ups

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/revisit-followups/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Use to turn explicit deferred work into a curated backlog. Read local `AGENTS.md`,
issue policy, and review-record conventions first.

1. Confirm the requested lookback window and collect only explicit deferred-action signals from
   completed changes, repository instructions, and closed work records.
2. Reject settled decisions, standing policy, completed checklists, and incidental TODO-like text.
   A zero-candidate result is valid.
3. Verify each remaining candidate against the current base, its history, closed-work disposition,
   existing issues, and active changes before proposing new work.
4. Group related candidates into self-contained issue drafts that preserve the original evidence and
   explain why the work remains needed.
5. Remain read-only unless the caller or consumer wrapper explicitly authorizes issue creation. If
   authorized, route every candidate through
   [github-issue](../github-issue/SKILL.md), including its denied-external tracking behavior; do not
   duplicate repository or label authorization. Then clean up temporary collection artifacts and
   report skipped, covered, and created items.

Consumer wrapper owns: review journal format, default lookback, hosting provider, repository,
issue taxonomy, and confirmation mechanism.
