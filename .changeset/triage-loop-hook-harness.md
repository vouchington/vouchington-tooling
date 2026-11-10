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
- `/shepherd`, `/plan`, and `/fix` comments from trusted logins reach the loop through the wait.
- `triage-sweep` gets a backstop phase for ejections and default-branch failures, and major
  dependency bumps now also require CI test coverage of the affected call sites.
- `ready-and-shepherd` drops the `comment` shepherd mode and its activation gates; shepherding is
  local.
