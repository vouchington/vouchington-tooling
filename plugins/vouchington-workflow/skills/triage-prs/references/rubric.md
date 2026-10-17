# Default triage rubric

This rubric is a default, not a law. Session steering from the user overrides it.

- **MERGE:** a real bugfix, a general root-cause fix, or a safe chore. A CI failure caused by the
  PR's own change is fine; the shepherd drives it green. A merge conflict (`CONFLICTING` or
  `DIRTY`) does not by itself warrant a close. If the fix is good on the merits, salvage it through
  the MERGE path: ready it, arm auto-merge, and let the shepherd rebase, resolve, and drive CI
  green. Salvage by default without asking the user.
- **CLOSE:** a narrow per-fingerprint band-aid (prefer general solutions), stale, superseded, or
  scope already landed on the default branch. Close a conflicting branch only when it is also one
  of those; never close a good fix solely because it conflicts.

## Before closing a narrow band-aid, ask whether it generalizes

A per-fingerprint band-aid often points at a root cause worth a general fix. Diagnose the failure
it papers over first. Is it:

- **repository-owned:** the repository's own code, config, or infrastructure, such as a step
  timeout, a permissions policy, a build toolchain, or a lock or port collision in its scripts;
- **deterministic:** it hits a fixed budget or limit. Litmus test: rerun the identical job
  unchanged; if it hits the same wall every time, raise the limit, remove the bottleneck, or
  restructure the work; or
- **transient:** the same input sometimes passes, such as an intermittent race, a propagation
  delay, or a genuinely external 5xx or rate limit?

Only the transient case justifies broadening a retry rule. Repository-owned and deterministic
failures make a retry rule invalid; the fix is the root cause.

- **Anti-fork:** never hardcode a concrete resource address (an ARN, a bus name, a batch id) into a
  fingerprint. Broaden the existing consumer-by-root-cause rule instead of forking one per action,
  status, or URL, following the adapter's retry-rule policy. A rule that hardcodes one resource
  re-fails the moment a different resource hits the same race.
- **Hard cases:** when a failure cannot be classified (no rerun-success evidence either way),
  never add or bump a retry rule as a substitute for classification. Fix the best-supported cause
  and capture the evidence the next occurrence needs, per the adapter's CI-failure policy.
- **Treadmill signature:** a rule whose attempt limit is bumped again on a later PR for the same
  consumer and root-cause pair, without the cause changing. That pair is repository-owned and was
  mis-elevated the first time; bumping it again repeats the mistake.
- **Elevate, do not hide:** a repository-owned cause must file or link a root-cause issue as part
  of the disposition, reusing an open issue for the same pair rather than duplicating it. A PR
  whose follow-ups say `None` while the cause is repository-owned is a signal to push back. For
  deterministic and repository-owned failures, close the band-aid and file a follow-up issue for
  the general fix under [github-issue](../../github-issue/SKILL.md), or re-scope an existing one.
  Generalize-or-elevate beats a plain close.

## What steering looks like

When a MERGE PR needs shepherd direction, write the exact reviewed comment body to a temporary file
with a file-writing tool, then read it back in full. Do not build the file with shell
interpolation, a heredoc, `echo`, or `printf`: file-based input keeps shell metacharacters and
backticks in reviewed steering from being expanded. Pass the file to the ready-and-shepherd skill
so it posts a separate ordinary PR comment before the shepherd trigger.

Examples:

- `Prefer the general timeout-bound solution over a transient-retry rule.`
- `The lint error is self-inflicted. Fix it first, then continue.`
- `Do not add a new catalogue rule. Fix the underlying race condition instead.`
- `This deadlock is transient. Broaden the matcher rather than closing the rule.`
- `This timeout is deterministic, not transient. Close the narrow rule and open a root-cause issue.`
