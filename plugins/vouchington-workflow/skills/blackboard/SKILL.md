---
name: blackboard
description: Record and retrieve concise contemporaneous session findings when the repository provides a journal or blackboard service.
---

# Session journal

Use when the current repository provides a journal, blackboard, or equivalent durable session
record. Read local `AGENTS.md` and `CLAUDE.md` for the provider, credential, retention, and
subagent-identity rules.

1. Append a concise note when a check fails, permission is denied, scope changes, a repeated fix is
   needed, or a tool result reveals a reusable gap. Include the finding, affected paths, concrete
   evidence, and any tracking reference.
2. Preserve the provider's required session and parent-session identity.
   - Do not invent, guess, print, search for, or persist a credential outside its documented
     mechanism.
   - When the provider supports repository metadata, keep the cumulative canonical repository list
     on that agent's own session. Tag each entry with only the repositories relevant to it.
   - Update session metadata before appending. Stop if that update fails.
3. If the journal service cannot authenticate or persist a mandatory entry, stop and report the
   blocker rather than silently substituting a local file or memory.
4. Read journal entries oldest-first when preparing a retrospective or clustering follow-ups; use
   direct evidence rather than reconstructing events from memory.

Consumer wrapper owns: service, command, note grammar, archival policy, and issue destination.
