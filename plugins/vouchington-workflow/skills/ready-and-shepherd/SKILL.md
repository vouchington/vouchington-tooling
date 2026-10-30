---
name: ready-and-shepherd
description: Move an authorized, triaged PR to ready, steer it, arm auto-merge, and hand it to a shepherd.
---

# Ready and shepherd

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/ready-and-shepherd/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Internal mechanics for batch triage callers (`triage-prs`, `triage-sweep`, or a consumer's
security-triage adapter). It moves a PR
those callers already reviewed to ready and hands it to a shepherd. It is not a general "mark any
draft ready" tool: a session working its own single PR runs pr-shepherd directly under the
CANCEL/ESCALATE contract and lets pr-shepherd own the draft-to-ready transition.

Arguments: a PR number or URL, `--repo <owner>/<name>`, optional `--arm-auto-merge`, and optional
`--steer-file <path>`. Pass `--repo` on every `gh` command.

## Adapter parameters

Resolve these before Step 1 and stop to ask when one this run needs is missing; never guess.

- **Shepherd mode:** `comment` (post an exact trigger comment that starts a CI-dispatched
  shepherd, fire-and-forget) or `local` (the caller runs pr-shepherd in a background worker until
  CANCEL/ESCALATE). Repositories without a CI shepherd workflow use `local`.
- **Trigger comment and activation gates** (`comment` mode only): the exact trigger body and the
  repository variables that must all read `true` before any mutation.
- **Automation label:** applied idempotently to every PR this skill readies.
- **Merge authority:** who authorizes `--arm-auto-merge` for which PR categories.

## Step 1 - Resolve and light review

Resolve the PR in `--repo`; reject one from another repository. Record `headRefOid`, read the diff
and CI state, and decide whether the shepherd needs direction (for example "prefer the general fix
over a narrow band-aid"). Write steering with a file-writing tool, never shell interpolation, and
read it back in full. With `--steer-file`, use that file instead.

## Step 2 - Activation preflight (fail closed)

Before any GitHub mutation, in `comment` mode read every adapter activation gate. An unset,
unreadable, empty, or non-`true` gate is disabled: stop before Step 3 and report
`activation disabled - unchanged`. Do not post steering, mark ready, add labels, arm, or trigger.
`local` mode has no gates; its preflight is that the caller can start a background worker.

Re-read `headRefOid` before every mutation below; if it moved, return to the caller for re-review.

## Step 3 - Steer (optional)

Post the reviewed steering file as an ordinary comment with `--body-file`, **before** arming or
triggering. Reject an empty file or one whose whole trimmed content equals the trigger comment.

## Step 4 - Mark ready and label

```bash
gh pr view <N> --repo <owner>/<name> --json isDraft --jq .isDraft   # true -> gh pr ready
gh pr edit <N> --repo <owner>/<name> --add-label <automation-label>
```

## Step 5 - Arm auto-merge (only with `--arm-auto-merge`)

Without the flag, skip this step; merge stays a human decision. Pass the flag only when the caller
holds merge authority for this PR's category under the adapter.

Check once per repository per run that auto-merge is allowed
(`gh api repos/<owner>/<name> --jq .allow_auto_merge`). When it is `false`, report
`manual merge required` and continue to Step 6. When the REST pull object has a `stack` field,
auto-merge is unavailable: report `stacked; needs explicit stack-merge authorization`, skip Steps 6
and 7, and follow [stacked-prs](../stacked-prs/SKILL.md) only under explicit human approval.

- **Unsteered:** arm now with exactly one bare command, never wrapped or compounded:
  `gh pr merge <N> --repo <owner>/<name> --auto --squash`. Arming succeeds on a conflicting branch;
  the shepherd resolves the conflict and the armed merge lands once checks pass.
- **Steered:** do not arm. Arming would race the shepherd before it consumes the steering. Leave the
  PR ready and unarmed; report `manual-verification-required`.

## Step 6 - Hand off to the shepherd

Never run two shepherds on one PR.

- **`comment` mode:** if the PR is still `OPEN`, post exactly the trigger body with
  `gh api -X POST repos/<owner>/<name>/issues/<N>/comments -f body=<trigger> --jq .id` and record
  the comment id. Dispatch is fire-and-forget: a `running` checkpoint proves acceptance, not
  success. Never poll the dispatch workflow or arm later from a `queued` or `running` state.
- **`local` mode:** return `shepherd: local` to the caller, which starts one background worker in
  an isolated worktree. The worker loops `pr-shepherd <owner>/<name>#<N> --until-terminal`, fixes
  each TRIAGE result, and stops at CANCEL or ESCALATE. A worker that ends in ESCALATE reports back
  to the caller, which escalates. The worker never merges.

## Step 7 - Verify and report

`gh pr view <N> --repo <owner>/<name> --json isDraft,autoMergeRequest,state`. Report per PR:
`ready`, `steered`, `auto-merge armed` (yes, no, manual-verification-required, unavailable),
`shepherd` (comment id, local, or no), and the reason for any `no`.

Consumer wrapper owns: shepherd mode, trigger body and activation gates, the automation label, merge
authority by PR category, and any provider-specific handoff variants.
