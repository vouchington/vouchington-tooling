---
'vouchington-tooling': minor
---

The `triage-loop`, `triage-sweep`, and `triage-prs` skills merge through pr-shepherd
(`vouchington-workflow` 0.21.0). Nothing arms auto-merge automatically.

- A single PR runs `pr-shepherd '<owner/repo#N>' --merge --until-terminal` and a stack runs
  `pr-shepherd stack <PR | 'owner/repo#N'> --merge --until-terminal`, as a background command in
  the loop session so its exit wakes the loop. The loop runs exactly the commands pr-shepherd prints,
  including the head-pinned `gh pr merge`, and requeues only through a printed `requeue:` or
  `acknowledge queue removal:` command. The `vouchington-reviewer status` gate is unchanged.
- The ready-and-merge procedure moves from `triage-loop/references/shepherd.md` into `triage-loop`,
  without the arm and disarm steps. `triage-sweep` Phase A no longer skips a PR whose auto-merge is
  already armed.
- `triage-prs` carries the agent-authored PR creation feedback guidance.
- The repository's own `dependabot-automerge` workflow is removed; the reusable action stays.
- `agent-workflow/references/implementation-and-review.md` is removed.
