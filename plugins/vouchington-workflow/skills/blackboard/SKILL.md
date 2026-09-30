---
name: blackboard
description: Record and retrieve contemporaneous findings in the repository journal.
---

# Session journal

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/blackboard/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Use when the current repository provides a journal, blackboard, or equivalent durable session
record. Read local `AGENTS.md` for the provider, credential, retention, and
subagent-identity rules.

Journal operations are tools of the `vouchington-tooling` MCP server (`vouchington mcp`):
`journal_append`, `journal_entries`, `outbox_status`, `outbox_flush`, `session_ensure`,
`snapshot_export`, and `session_archive`. A harness may prefix the tool names with the server name.
Every call takes an exact `sessionId`, never inferred, whose meaning depends on the tool:

- `journal_append` and `session_ensure`: the session written or ensured, which is the caller's own
  session unless a runner ensures a child identity.
- `journal_entries` and `session_archive`: the session read or archived, which during distillation
  belongs to another agent.
- `snapshot_export`, `outbox_status`, and `outbox_flush`: only the caller. The outbox tools cover
  every record in the worktree outbox, not only that session's.

Every call may take `worktree`, the absolute path of a worktree of the current repository (the
launch worktree by default). Writing or retrying an entry needs no provider skill, temporary file,
`--file` flag, or replay command.
If these tools are not available because the server is not registered or not connected, stop and
report that the journal server is unavailable. Do not fall back to a CLI command.

1. Capture consequential observations before filing an issue: failed or recovered checks, denied or
   approved permissions, repeated fixes, scope changes, first-party tool behavior, and architectural
   findings. Record useful resolved outcomes as well as unresolved gaps. Include bounded evidence,
   affected areas, an explicit disposition, and an existing tracking reference when present.
   Journal meaningful skips or bypasses of applicable configured workflows before completion, with
   the owning workflow or command-catalog entrypoint, reason, and observed result/action.
2. Record each observation with one `journal_append` call and pass the note as its `markdown`
   argument (at most 12000 bytes). Required arguments are `sessionId`, `parentSessionId` (null for a
   root session), `agent`, `version`, `mode`, `markdown`, a stable `sourceEventId`, `workOutcome`,
   canonical exact `repositories`, and explicit `feedbackCoverage`. Also pass an ISO 8601
   `timestamp` fixed before the first attempt: the server otherwise generates one, and a failed or
   timed-out call returns no result to learn it from. Nothing is written unless the
   whole envelope validates. The tool writes journal entries; `category` is optional context and
   never changes storage type or distillation eligibility. Generate routine facts and metadata
   through the approved composer and pass its output as `markdown` instead of hand-authoring
   factual markers.
3. Preserve exact provider session and parent identities. Each agent writes only its own session.
   `journal_append` ensures that session and merges the entry's `repositories` into the session's
   cumulative repository union, so list every repository the entry concerns. Never infer another
   repository from prose or create a child identity from a model guess. Call `session_ensure` with
   the exact identity only when a runner must confirm the session before work starts.
4. Select the repository's trusted `mode` (`interactive` or `autonomous`) explicitly. In interactive
   mode an outage may retain the validated, sanitized record in the bounded durable outbox, and
   `journal_append` reports it as pending. Report the pending count from `outbox_status`, deliver
   with `outbox_flush` once the provider is reachable, and continue primary work only after
   persistence succeeds. A full, unsafe, or unwritable outbox blocks capture; never evict or
   silently discard an unsent record.
5. Autonomous runners require online `session_ensure`, a fresh admission `journal_append`, and
   readback before launching an attempt. Give each attempt's admission entry a `sourceEventId`
   unique to that attempt: reusing an earlier one returns the earlier receipt, which does not
   prove a fresh write. Autonomous mode has no filesystem outbox, so a failed delivery is an error.
   Terminal reporting preserves work outcome separately from feedback coverage and delivery. A
   filesystem outbox never grants admission or acknowledged completion.
6. Use at-least-once delivery with consumer deduplication by exact session/source identity. To
   retry a pending or failed append, call `journal_append` again with the same `sourceEventId`,
   content, and `timestamp` from the first attempt: the whole envelope must match, and conflicting
   source reuse is rejected. A transport timeout can leave a late
   durable write; pending or blocked is never an acknowledged receipt.
7. Read the session's entries oldest-first with `journal_entries` for retrospectives. It returns
   every entry with its envelope, including its type and repository tags, so a retrospective can
   find an existing retrospective and keep entry-level tags. Record explicit
   none-observed with inspected scope, or not-assessed/unavailable with reason, when evidence does
   not establish a finding. A permission request is not proof of approval or denial; localhost
   refusal is not proof of sandbox enforcement. Mark partial capture and dropped counts instead of
   reporting clean evidence.

Never search for, print, invent, or mint credentials. Durable entries and outbox records contain only
bounded structured facts or sanitized summaries, never raw command output, transcript content,
environment dumps, provider payloads, or secrets. Known-secret redaction supplements the author's
minimization responsibility; it cannot prove arbitrary prose contains no undisclosed secret.

Consumer wrappers own service configuration, server registration and approval rules, trusted mode
selection, issue routing, and archival authorization. The server fixes the outbox location.
