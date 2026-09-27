---
name: retrospective
description: Summarize completed work from verified facts and the session journal.
---

# Retrospective

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/retrospective/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Use at task completion or session close-out when the repository has a retrospective workflow. Read
local `AGENTS.md`, and journal guidance first.

1. Check whether a retrospective already exists. Append only a material delta when local policy
   says to append.
2. Gather verifiable facts from the repository's approved status, validation, issue, and journal
   sources. Do not estimate unknown facts from memory or transcripts.
3. Summarize the outcome, plan-versus-actual differences, validation evidence, recurring friction,
   and actionable process improvements. Keep one-off noise separate from a repeatable root cause.
   Preserve each source entry's repository attribution when the journal supports it. A retrospective
   that spans repositories names every represented repository.
4. Save through the repository's required durable mechanism. Report the record identifier and any
   follow-up decisions.

Use raw evidence only for local verification. Save only bounded structured facts or redacted
summaries in a durable retrospective; never embed unredacted logs, command output, environment
dumps, provider payloads, or transcript content there.

Consumer wrappers add transcript access, retention, a report schema, a journal provider, and issue
filing policy. They cannot weaken this minimization boundary.
