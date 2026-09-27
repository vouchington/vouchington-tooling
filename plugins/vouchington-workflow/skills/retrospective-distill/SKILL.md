---
name: retrospective-distill
description: Turn completed session records into verified follow-up candidates.
---

# Retrospective distillation

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/retrospective-distill/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Use when completed retrospectives or journals should become durable follow-up work. Read local
`AGENTS.md`, issue policy, and journal retention rules before any mutation.

1. Enumerate only completed, eligible session records. For repository-scoped work, filter sessions
   by repository membership and use only entries attributed to that repository. Leave untagged
   legacy records unclassified. Do not infer their repository. Leave in-progress sessions intact.
2. Validate storage type and the shared envelope independently of optional category. Never repair
   unknown legacy types or repository provenance by inference. Quarantine malformed sessions with
   an explicit reason while processing valid unrelated sessions. Deduplicate at-least-once records
   by exact session/source identity and reject conflicting duplicate content. Retain coverage,
   dropped counts, requested versus observed outcomes, and useful resolved findings.
3. Cluster findings by root cause. Prefer a few broad actionable themes over many narrow issues.
   Treat a finding already linked to an open tracker as context, not a duplicate.
4. Verify each candidate against the current base. Search existing issues and open changes before
   drafting. Skip work that is complete, explicitly rejected, or already covered. A first-party version
   bump is not proof of resolution: verify the adopted change against the original finding before
   deferring. Capture a new observation in the journal before filing it.
5. Draft self-contained issues with the problem, concrete proposed work, relevant areas, and
   validation. Route every authorized creation through
   [github-issue](../github-issue/SKILL.md), including its repository gate, label approval, and
   denied-external tracking behavior.
6. Archive only records fully processed across every represented repository, under the repository's
   retention rules. A one-repository pass leaves a multi-repository session active until the other
   repositories are reviewed. Report reviewed, fixed, duplicate, deferred, quarantined, and
   actionable dispositions with reasons. Keep the top five themes in human prose without dropping
   underlying findings or unresolved records.

Use source records only for local verification and leave them in the repository's approved journal
or retention system. Public issue bodies contain only the minimum bounded facts or redacted
summaries needed to establish the problem, proposed work, relevant areas, and validation. Never
embed unredacted logs, command output, environment details, provider payloads, or transcript
content.

This skill supplies no journal API, issue repository, labels, milestones, projects, archival
command, or approval model. Consumer wrappers cannot weaken this export boundary; they provide only
those local details.
