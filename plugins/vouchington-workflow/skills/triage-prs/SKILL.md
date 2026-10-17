---
name: triage-prs
description: Review the PR queue and merge or close PRs under the user's triage authorization.
---

# Triage pull requests

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/triage-prs/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Review open pull requests, merge the good ones, and close the rest. The argument is an optional
scope: PR numbers, an author, a label, `all`, a title substring, or blank for the default scope.

## Adapter parameters

The repository adapter (a consumer wrapper skill or `AGENTS.md`) owns every repository-specific
value. Resolve these before Step 1 and stop
to ask when one this run needs is missing; never guess a value.

- **Automation label:** the label that marks machine-created PRs. It defines the default scope.
- **Orphan-issue rules:** the labels or title prefix that identify automation-created issues, and
  the label that marks intentional PR-free backlog items.
- **Ready-and-shepherd skill:** the skill or command that marks a PR ready, posts steering, arms
  auto-merge, and dispatches the shepherd, with its flags and activation preflight.
- **Prompt-source paths:** the exact paths that may be edited from PR-creation feedback, and the
  rubric for that feedback.
- **Feedback marker:** the PR-body marker that identifies a feedback PR from this flow.
- **Merge authority and CI-failure policy:** who may authorize a merge, how transient failures are
  classified, and where retry rules live.

## Step 1 - Resolve scope

With no argument, target every open PR carrying the adapter's automation label:

```bash
gh pr list --state open --limit 100 --label <automation-label> --json number,title
```

PRs opened before the label existed need an explicit one-time backfill with
`gh pr edit <N> --add-label <automation-label>` before they enter the default scope.

With an argument, interpret it as the scope:

- Explicit PR numbers: use them directly.
- Author: `gh pr list --author <login> --state open --limit 100`
- Label: `gh pr list --label <name> --state open --limit 100`
- `all`: every open PR regardless of author.
- Title substring: `gh pr list ... | jq 'select(.title | test("<pattern>"; "i"))'`

**Safety: a broad or non-default scope needs confirmation.** The default automation-label query is
a reliable machine-set signal, so proceed on it directly. For any other scope (`all`, an author, a
title match, or another label) the set can include human-authored PRs, so always confirm the close
list with the user before executing closes or branch deletions.

## Step 2 - Gather status

Fetch CI rollup and diff sizes for the in-scope PR numbers only. Do not re-fetch all open PRs:
a broader list pulls out-of-scope PRs into the review and close queues.

```bash
gh pr view <N> --json number,title,isDraft,additions,deletions,changedFiles,statusCheckRollup
```

Run one call per PR, or filter one `gh pr list --json ...` result with
`jq 'select(.number | IN(<N1>,<N2>,...))'` when the set is large.

## Step 3 - Review and steering assessment

Batch the in-scope PRs across up to three parallel read-only agents. Each reads the PR
description and full diff, loads [review-ci-logs](../review-ci-logs/SKILL.md) for failing required
checks, and returns per PR:

- **Decision:** `MERGE` or `CLOSE`
- **Reason:** a one-line summary
- **Steering:** (MERGE only) whether the shepherd needs direction, and the exact PR comment body
- **PR creation feedback:** for verified agent-authored PRs, apply the adapter's rubric and return
  evidence, provenance, the exact source target, a recommendation, and a recurrence tag;
  otherwise `none`

Each agent reads with `gh pr view <N>`, `gh pr diff <N>`, and the repository's CI check listing.

See [the default rubric](references/rubric.md) for MERGE versus CLOSE, generalizing a narrow
band-aid before closing it, and the shape of steering comments. The user's session steering
overrides the rubric, including flipping a green PR to CLOSE; present it as context.

## Step 4 - Execute MERGE

Process MERGE decisions in ascending PR-number order through the adapter's ready-and-shepherd
skill, passing the PR number, the auto-merge flag, and any steering file. That skill light-reviews
the diff, posts steering before the trigger, readies the draft, verifies merge settings, and
dispatches the shepherd. Run its activation preflight before every mutation. If activation is
disabled, unset, or unreadable, record `activation disabled - unchanged` and do not describe the PR
as ready, armed, or dispatched.

Classify the outcome:

- **Unsteered and arming succeeds:** already armed. Auto-merge may complete once requirements pass
  while the asynchronous shepherd independently checks the PR.
- **Steered, or arming fails on a conflict:** leave the PR ready and unarmed after dispatch.
  Dispatch is fire-and-forget; a `running` checkpoint proves session acceptance, not success. A
  human inspects the eventual state and decides whether to arm auto-merge. Do not wait for or infer
  a `complete` checkpoint.
- **Repository auto-merge disabled:** dispatch the shepherd, report that a manual merge is
  required, and leave auto-merge unchanged.
- **Native GitHub stack:** shepherd the owned layers per
  [stacked-prs](../stacked-prs/SKILL.md#ownership-and-workers) and merge the ready prefix per
  [Merge the ready prefix](../stacked-prs/SKILL.md#merge-the-ready-prefix), within explicit human
  approval and only as far as this run's decisions cover. Resolve the full stack against the Step 1
  scope and Step 3 decisions first. End the ready prefix below the first layer that is out of scope
  or not `MERGE`; never shepherd or merge a layer this run did not review. GitHub has no
  auto-merge for stacks, and an armed auto-merge does not authorize the drain on its own.

Do not add a second pass that polls the dispatch workflow. It ends once the session is accepted or
rejected and cannot attest that the remote agent consumed steering or left the branch mergeable.

## Step 5 - Execute CLOSE

```bash
gh pr close <N> --delete-branch --comment "Closing: <one-line reason>"
```

Branch auto-deletion is a merge-time repository setting and does not apply to closes, so
`--delete-branch` is required. Then check for linked issues:

```bash
gh pr view <N> --json closingIssuesReferences --jq '.closingIssuesReferences[] | {number, title}'
```

Close a returned issue only if it appears automation-created under the adapter's orphan-issue
rules. Skip anything that looks human-authored: automation sometimes reuses a human-tracked issue
by adding `Closes #<N>` to a PR body, and closing it would discard legitimate open work.

```bash
gh issue close <ISSUE_N> --comment "Closing alongside PR #<N>: <same one-line reason>"
```

For default-scope runs, also close [orphan automation issues](references/orphans.md).

## Step 6 - Verify and report

Check that merge and close actions landed:

```bash
gh pr view <N> --json isDraft,autoMergeRequest,state
```

Emit a summary table with the columns PR, Decision, Action, and Steering. Actions are
`ready + shepherd + auto-merge armed`, `ready + shepherd, manual verification required`,
`ready + shepherd, manual merge required`, `activation disabled - unchanged`, and
`closed + branch deleted`.

After Steps 4 and 5, amend the Step 3 creation feedback with action-time steering and CI evidence.
Do not wait for the newly dispatched shepherd; record only evidence available during this run.
Then publish [preauthorized prompt feedback](references/feedback.md), group the recommendations by
root cause, and invoke [retrospective](../retrospective/SKILL.md) before the final report.
