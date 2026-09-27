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
