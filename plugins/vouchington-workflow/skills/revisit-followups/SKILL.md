---
name: revisit-followups
description: Review recently completed work and repository instructions for genuinely deferred follow-ups, then propose verified issue candidates.
---

# Revisit follow-ups

Use to turn explicit deferred work into a curated backlog. Read local `AGENTS.md`, `CLAUDE.md`,
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

Do not assume a review journal format, default lookback, hosting provider, repository, issue
taxonomy, or confirmation mechanism. Consumer wrappers own those integrations.
