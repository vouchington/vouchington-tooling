---
name: planning
description: Create an evidence-backed implementation plan for a repository change or a justified no-change recommendation.
---

# Planning

Use before implementation work that needs a durable plan. Repository-local `AGENTS.md`,
`CLAUDE.md`, issue templates, and planning conventions override this portable foundation.

1. State the desired outcome and compare no change, reuse, and alternative approaches. Choose the
   smallest durable option; ask before treating an unresolved product choice as settled.
2. Read applicable instructions, documentation, current code, tests, and recent changes from a
   fresh base. Record which evidence supports each proposed path.
3. Map affected owners, public contracts, migrations, operational boundaries, and tests. Use
   independent review or exploration when the change is cross-cutting or uncertain.
4. Specify implementation steps, file-level intent, validation, rollout, and any follow-up that is
   truly outside the accepted scope. Distinguish existing paths from new paths.
5. Validate and save the plan using the repository's required issue or document workflow before
   implementation when local policy requires one.

Do not invent a plan template, default repository, issue taxonomy, dependency graph tool, or
approval workflow. A consumer wrapper owns those choices.
