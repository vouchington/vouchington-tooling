---
'vouchington-tooling': minor
---

`triage-loop` replaces the retired auto-harness, using the `hook-harness` npm package as its event
source (`vouchington-workflow` 0.17.0).

- `triage-loop` keeps one background `hook-harness wait`, dedupes events on `id`, persists the
  cursor, and relaunches. `gap: true` runs a GitHub API backstop; a failed wait falls back to
  sweeps. The wait timeout is the heartbeat, so idle wakeups are gone.
- Merge-queue ejections and default-branch failures are diagnosed with `review-ci-logs`. In-grant
  ejected PRs with an unchanged head are re-enqueued. Flakes are filed, optionally delegated to a
  user-configured named session, or fixed by a worktree subagent; a flake-fix PR merges only when its
  diff is test-only.
- `/shepherd`, `/plan`, and `/fix` comments from trusted logins reach the loop through the wait and
  are acknowledged with an `eyes` reaction. `/shepherd` shepherds a PR, or a whole native stack,
  once. Loop-created PRs get the automation label at creation.
- Agents shepherd their own PRs with pr-shepherd. Posting `/shepherd` is an optional delegation to
  the loop (one comment on the top PR of a stack); after it the loop owns the PR and only the loop
  merges, within its grant. `agent-workflow`, `stacked-prs`, and `final-review` describe it.
- `triage-sweep` gets a backstop for ejections and default-branch failures and another for missed
  command comments, and major dependency bumps now also require CI test coverage of the affected
  call sites.
- **Breaking:** the `ready-and-shepherd` skill is removed. It was internal to the loop; its
  procedure now lives in `triage-loop/references/shepherd.md`, used by `triage-loop`,
  `triage-sweep`, and `triage-prs`. Consumer adapters aliasing it should switch to the
  `triage-loop` adapter (the automation label now redefined as PRs created or readied by the loop
  or its subagents). `vouchington-workflow` stays at 0.17.0, the pre-1.0 minor that already carries
  this PR.
- The `comment-command-parse`, `comment-command-authorize`, `comment-command-acknowledge`, and
  `issue-comment-context` actions are deprecated (not removed), and the README's `/fix` workflow
  example is gone.
