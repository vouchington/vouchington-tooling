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

1. Enumerate only completed, eligible session records with the `snapshot_export` tool of the
   `vouchington-tooling` MCP server, narrowing by `agent`, `version`, `parentSessionId`, exact
   `data` fields, `dataArrayContains`, and `inactiveForHours`. It exports non-archived sessions to a
   private local file and returns the path, counts, checksum, and manifest, never the records.
   Read full records, with their storage type, repository tags, source identity, coverage, and
   outcomes, from that file. Do not distill from `journal_entries`: it returns only each journal
   entry's time and markdown, so it cannot attribute, validate, or deduplicate entries. For
   repository-scoped work, filter sessions by repository membership (`dataArrayContains` with
   `repositories` and the exact `owner/name`) and use only entries attributed to that repository. Leave untagged legacy records unclassified. Do
   not infer their repository. Leave in-progress sessions intact. If the server is not connected,
   stop and report it; do not fall back to a CLI command.
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
   retention rules, with one `session_archive` call per session whose `sessionId` is the archived
   session, not the caller. Archiving
   makes the session's metadata immutable, so it needs the archival authorization that local policy
   requires. A one-repository pass leaves a multi-repository session active until the other
   repositories are reviewed. Report reviewed, fixed, duplicate, deferred, quarantined, and
   actionable dispositions with reasons. Keep the top five themes in human prose without dropping
   underlying findings or unresolved records.

Use source records only for local verification and leave them in the repository's approved journal
or retention system. Public issue bodies contain only the minimum bounded facts or redacted
summaries needed to establish the problem, proposed work, relevant areas, and validation. Never
embed unredacted logs, command output, environment details, provider payloads, or transcript
content. A snapshot file is a private local copy of source records: never commit or attach it, or
copy its contents into an issue.

This skill supplies no issue repository, labels, milestones, projects, or approval model; it reads
sessions only from the snapshot file that `snapshot_export` writes, and archives them only with
`session_archive`. Consumer wrappers cannot weaken this export
boundary; they provide only those local details.
