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

1. Capture consequential observations before filing an issue: failed or recovered checks, denied or
   approved permissions, repeated fixes, scope changes, first-party tool behavior, and architectural
   findings. Record useful resolved outcomes as well as unresolved gaps. Include bounded evidence,
   affected areas, an explicit disposition, and an existing tracking reference when present.
   Journal meaningful skips or bypasses of applicable configured workflows before completion, with
   the owning workflow or command-catalog entrypoint, reason, and observed result/action.
2. Use the shared validated envelope with storage `type: journal` or `retrospective`, canonical exact
   entry repositories, stable `sourceEventId`, work outcome, and explicit feedback coverage. Category
   is optional context; it never changes storage type or distillation eligibility. Generate routine
   facts and metadata through the approved composer instead of hand-authoring factual markers.
3. Preserve exact provider session and parent identities. Each agent writes only its own session.
   Update that session's cumulative repository union before appending; never infer another repository
   from prose or create a child identity from a model guess.
4. Select the repository's trusted mode explicitly. Interactive outages may retain validated,
   sanitized feedback in the bounded durable outbox. Report pending count and delivery state, replay
   with the same source identity, and continue primary work only after persistence succeeds. A full,
   unsafe, or unwritable outbox blocks capture; never evict or silently discard an unsent record.
5. Autonomous runners require online session ensure, a fresh admission write, and readback before
   launching an attempt. Terminal reporting preserves work outcome separately from feedback
   coverage and delivery. A filesystem outbox never grants admission or acknowledged completion.
6. Use at-least-once delivery with consumer deduplication by exact session/source identity. A
   transport timeout can leave a late durable write; pending or blocked is never an acknowledged
   receipt. Replay verifies matching content before retrying and rejects conflicting source reuse.
7. Read journal entries oldest-first for retrospectives. Record explicit none-observed with inspected
   scope, or not-assessed/unavailable with reason, when evidence does not establish a finding. A
   permission request is not proof of approval or denial; localhost refusal is not proof of sandbox
   enforcement. Mark partial capture and dropped counts instead of reporting clean evidence.

Never search for, print, invent, or mint credentials. Durable entries and outbox records contain only
bounded structured facts or sanitized summaries, never raw command output, transcript content,
environment dumps, provider payloads, or secrets. Known-secret redaction supplements the author's
minimization responsibility; it cannot prove arbitrary prose contains no undisclosed secret.

Consumer wrappers own service configuration, trusted mode selection, commands, outbox location,
issue routing, and archival authorization.
