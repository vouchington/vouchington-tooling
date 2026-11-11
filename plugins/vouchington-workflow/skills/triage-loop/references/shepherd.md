# Ready and shepherd

The loop's own procedure for moving a PR it reviewed to ready and starting one local shepherd. It is
used by the loop, `triage-sweep`, and `triage-prs`, and by the `/shepherd` handler. It is not a
general "mark any draft ready" tool: an agent working its own PR runs pr-shepherd itself.

Inputs: a PR number, `--repo <owner>/<name>` (pass it on every `gh` command), optional
`--arm-auto-merge`, and optional `--steer-file <path>`. The adapter supplies the automation label
and the merge authority per PR category; stop and ask when one is missing.

1. **Resolve and light review.** Resolve the PR in `--repo`; reject one from another repository.
   Record `headRefOid`, read the diff and CI state, and decide whether the shepherd needs direction
   (for example "prefer the general fix over a narrow band-aid"). Write steering with a file-writing
   tool, never shell interpolation, and read it back in full.
2. **Preflight.** Check that a background worker can start. Re-read `headRefOid` before every
   mutation below; if it moved, return for re-review. Skip a PR that `shepherds` already records.
3. **Steer (optional).** Post the reviewed steering file as an ordinary comment with
   `--body-file` **before** arming. Reject an empty file.
4. **Mark ready and label.**
   `gh pr view <N> --repo <owner>/<name> --json isDraft --jq .isDraft` (true: `gh pr ready`), then
   `gh pr edit <N> --repo <owner>/<name> --add-label <automation-label>`.
5. **Arm auto-merge (only with `--arm-auto-merge`).** Pass the flag only for a category the grant
   covers. Check once per repository per run that `gh api repos/<owner>/<name> --jq
   .allow_auto_merge` is true; when `false`, report `manual merge required` and continue. When the
   REST pull object has a `stack` field, auto-merge is unavailable: report `stacked; needs explicit
   stack-merge authorization`, skip arming, and follow
   [stacked-prs](../../stacked-prs/SKILL.md) under the grant or explicit human approval.
   - **Unsteered:** arm with exactly one bare command:
     `gh pr merge <N> --repo <owner>/<name> --auto --squash`. Arming succeeds on a conflicting
     branch; the shepherd resolves it and the armed merge lands once checks pass.
   - **Steered:** do not arm; arming would race the shepherd before it consumes the steering. Leave
     the PR ready and unarmed and report `manual-verification-required`.
6. **Start the shepherd.** Never run two shepherds on one PR. Start one background worker in an
   isolated worktree (or a workspace agent the adapter names) that runs
   `pr-shepherd <owner>/<name>#<N> --until-terminal` and reruns it after every result except CANCEL
   and ESCALATE: TRIAGE means fix and rerun; READY or a quota warning means rerun after the printed
   delay; MERGE means the worker never merges, it reports the PR mergeable and stops. For a stack,
   use `pr-shepherd stack`. Record the handoff (PR, head, worker id, time) in `shepherds`. Nothing
   waits on the worker; on ESCALATE it reports back and the loop escalates. Remove the entry when
   the worker stops.
7. **Verify and report.** `gh pr view <N> --repo <owner>/<name> --json
   isDraft,autoMergeRequest,state`. Report per PR: ready, steered, auto-merge (armed, no,
   manual-verification-required, unavailable), shepherd (local or no), and the reason for any `no`.

The loop never posts `/shepherd` to itself: `/shepherd` is how another agent delegates a PR to it.
