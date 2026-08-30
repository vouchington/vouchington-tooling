---
name: retrospective-distill
description: Distill completed session records into a small set of verified, actionable follow-up issues.
---

# Retrospective distillation

Use when completed retrospectives or journals should become durable follow-up work. Read local
repository-local instructions, issue policy, and journal retention rules before any mutation.

1. Enumerate only completed, eligible session records. Leave in-progress sessions intact.
2. Cluster findings by root cause, favoring a few broad actionable themes over many narrow issues.
   Treat a finding already linked to an open tracker as context, not a duplicate.
3. Verify each candidate against the current base and search existing issues and open changes before
   drafting. Skip work that is complete, explicitly rejected, or already covered.
4. Draft self-contained issues with the problem, concrete proposed work, relevant areas, and
   evidence embedded in the body. Route every authorized creation through
   [github-issue](../github-issue/SKILL.md), including its repository gate, label approval, and
   denied-external tracking behavior.
5. Archive only records that were fully processed under the repository's retention rules; report
   created, updated, skipped, and deferred themes with reasons.

This skill supplies no journal API, issue repository, labels, milestones, archival command, or
approval model. A consumer wrapper provides those details.
