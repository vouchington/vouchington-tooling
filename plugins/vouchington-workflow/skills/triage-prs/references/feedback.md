# Publish preauthorized prompt feedback

Invoking triage explicitly authorizes the GitHub mutations below, but only for actionable feedback
whose provenance and exact source are verified under the adapter's prompt-source paths. A PR body
containing the adapter's feedback marker is a feedback PR from this flow: review it normally in the
queue, but return `none` for its own PR-creation feedback so the loop cannot recur.

For the current batch, combine every qualifying finding, including `one-off` findings, into one
feedback issue and one draft feedback PR. Record the proportional plan in that issue; it is the
sole closing source for the PR. Reviewed PRs are evidence only and are never closing references.

Before publication, verify at action time:

- The PR is verified agent-authored, the source target is an exact prompt-source path, and the
  recommendation remains actionable after the refresh.
- Each source exists on the refreshed default branch.

## Duplicate resolution

Compare the marker and the normalized set of exact source paths on open feedback PRs:

- `duplicate: zero-overlap`: create one feedback issue and one draft PR.
- `duplicate: exact-match`: reuse the one canonical matching PR and its source issue; create
  neither.
- `duplicate: ambiguous`: fail closed. Any partial overlap, more than one exact match, or any
  uncertain provenance or source set creates nothing.

For a create, save the plan in the feedback issue through [github-issue](../../github-issue/SKILL.md)
and write the draft PR with [pr-description](../../pr-description/SKILL.md). The PR body includes
the marker, carries the automation label, and links the feedback issue with a closing keyword. Do
not ready, shepherd, auto-merge, or merge a generated or reused feedback PR in the same run.

## Retrospective disposition

- `disposition: published`: record `Disposition: preauthorized-pr #N` after a successful create or
  exact-match reuse.
- `disposition: deferred`: record `deferred` with the concrete blocker after a failed, partial, or
  ambiguous publication. Do not ask the user or claim the feedback was handled.
- `disposition: user-choice`: keep non-prompt feedback in the normal human follow-up flow.

Group the Step 3 PR-creation recommendations by root cause and invoke
[retrospective](../../retrospective/SKILL.md). It records findings for merged and closed PRs alike.
Preserve `none` when no actionable generator improvement was found, and complete this flow before
the final triage report.
