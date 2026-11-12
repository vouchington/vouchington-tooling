---
'vouchington-tooling': minor
---

`triage-sweep` gets Phase G3 for scheduled maintenance prompts (`vouchington-workflow` 0.18.0).

- Each full sweep runs the adapter's quota of scheduled prompts (default one), rotating
  round-robin over a list rebuilt from every selected repository's default branch. The rotation
  position and a bounded run history live in the state file's `scheduledPrompts`.
- A prompt renders through the adapter's PR or issue wrapper template and runs in one
  implementation-tier subagent in an isolated worktree, with at most one draft automation PR. A
  separate reviewer, never the author, checks every outcome; a passing PR is marked ready for
  Phase B, and failures go back to the author or are escalated.
- `triage-loop` lists the scheduled-prompt adapter parameters and the `scheduledPrompts` state
  field. The summary gains a `scheduled run` action.
