# Publish preauthorized prompt feedback

Invoking triage explicitly authorizes the GitHub mutations below, but only for actionable feedback
whose provenance and exact source are verified under the adapter's prompt-source paths. A PR body
containing the adapter's feedback marker is a feedback PR from this flow: review it normally in the
queue, but return `none` for its own PR-creation feedback so the loop cannot recur.

For the current batch, combine every qualifying finding, including `one-off` findings, into one
feedback issue and one draft feedback PR. Record the proportional plan in that issue; it is the
sole closing source for the PR. Reviewed PRs are evidence only and are never closing references.

Every feedback PR and source issue created or reused here joins the run's exclusion set, which
applies to the merge, close, linked-issue, and orphan passes. Verify its head before updating it.
Pass generated titles, bodies, and comments to `gh` only through files (`--body-file`).

Before publication, verify at action time:

- The PR is verified agent-authored, the source target is an exact prompt-source path, and the
  recommendation remains actionable after the refresh.
- Each source exists on the refreshed default branch.

## Duplicate resolution

A candidate counts as a match only with verified provenance: it was created by the adapter's
automation identity and its body closes the feedback issue it is paired with. A candidate that
carries the marker without that provenance is untrusted: never reuse or update it, and treat any
overlap with it as `duplicate: ambiguous`.

Compare the marker, the normalized set of exact source paths, and the normalized
recommendation or root-cause identity on open feedback PRs:

- `duplicate: zero-overlap`: create one feedback issue and one draft PR.
- Before reusing or updating a canonical PR or issue, re-read it: both must still be open and
  unchanged since the comparison (same head and body); otherwise re-run the comparison.
- `duplicate: exact-match`: the path set and the recommendation or root-cause identity both match
  one canonical PR. Reuse that PR and its source issue; create neither.
- `duplicate: same-paths-new-feedback`: the path set matches but the recommendation differs.
  Update the canonical PR and its issue with the new feedback; create neither.
- `duplicate: ambiguous`: fail closed. Any partial overlap, more than one exact match, or any
  uncertain provenance or source set creates nothing.

For a create, save the plan in the feedback issue through [github-issue](../../github-issue/SKILL.md)
and write the draft PR with [pr-description](../../pr-description/SKILL.md). The PR body includes
the marker, carries the automation label, and links the feedback issue with a closing keyword. Do
not ready, shepherd, auto-merge, or merge a generated or reused feedback PR in the same run.

## Retrospective disposition

- `disposition: published`: record `Disposition: preauthorized-pr #N` after a successful create,
  exact-match reuse, or `same-paths-new-feedback` update of the canonical PR and issue.
- `disposition: deferred`: record `deferred` with the concrete blocker after a failed, partial, or
  ambiguous publication. Do not ask the user or claim the feedback was handled.
- `disposition: user-choice`: keep non-prompt feedback in the normal human follow-up flow.

Group the Step 3 PR-creation recommendations by root cause and invoke
[retrospective](../../retrospective/SKILL.md). It records findings for merged and closed PRs alike.
Preserve `none` when no actionable generator improvement was found, and complete this flow before
the final triage report.
