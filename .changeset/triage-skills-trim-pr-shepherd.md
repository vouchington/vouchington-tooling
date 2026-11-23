---
'vouchington-tooling': patch
---

vouchington-workflow 0.28.2: the triage skills drop what pr-shepherd already owns. The loop no longer requeues ejected PRs (the shepherding agent does, through pr-shepherd's merge-queue-ejection playbook) and notifies an owner only when no shepherd is running. Ready and merge step 6 keeps only the working directory, the `shepherds` record, and the final-review gate; the orchestrator runs each PR's shepherd, never a subagent too. `/shepherd` handoff is written as draft-handoff adapter values (gate, dispatch, checkpoint) and overrides its stack rule. The `manual-verification-required` status is now `steered-hold`. CI failures follow pr-shepherd's `[TRIAGE]`; conflicts in lockfiles and generated files are regenerated with pnpm, never merged by hand; a conflicted Dependabot PR points to the `dependabot` skill instead of `@dependabot recreate`.
