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
5. **Request final review and gate on it.** Request a review of the current head with
   `gh api --method POST repos/<owner>/<name>/issues/<N>/labels -f 'labels[]=final-review:requested'`
   (or message the `final-reviewer` session with `<owner>/<name>#<N>`); adding it again requests a
   re-review after new commits. The standing reviewer lives in `vouchington/vouchington-reviewer`.
   Run `pnpm --dir <reviewer-checkout> exec vouchington-reviewer status --repo <owner>/<name> --pr <N>`
   before arming, merging, or re-enqueueing: exit 0 means the newest final review approved the
   current head and the `final approval` label is present. Any other exit code means do not merge:
   when `gh pr view <N> --repo <owner>/<name> --json autoMergeRequest --jq .autoMergeRequest` is
   set (armed earlier), first run `gh pr merge <N> --repo <owner>/<name> --disable-auto`; then
   leave the PR ready and unarmed, report `awaiting-final-review`, and let a later sweep rerun the
   check. Nothing waits on the reviewer. This gate is procedural: GitHub enforces it only through a
   required status check, or branch protection that dismisses stale approvals, which the consuming
   repository's adapter owns.
6. **Arm auto-merge (only with `--arm-auto-merge`, and only when step 5 exited 0).** Pass the flag
   only for a category the grant covers. Check once per repository per run that
   `gh api repos/<owner>/<name> --jq .allow_auto_merge` is true; when `false`, report `manual merge required` and continue. When the
   REST pull object has a `stack` field, auto-merge is unavailable: report `stacked; needs explicit
   stack-merge authorization`, skip arming, and follow
   [stacked-prs](../../stacked-prs/SKILL.md) under the grant or explicit human approval.
   - **Unsteered:** arm with exactly one bare command:
     `gh pr merge <N> --repo <owner>/<name> --auto --squash`. Arming succeeds on a conflicting
     branch; the shepherd resolves it and the armed merge lands once checks pass.
   - **Steered:** do not arm; arming would race the shepherd before it consumes the steering. Leave
     the PR ready and unarmed and report `manual-verification-required`.
7. **Start the shepherd.** Never run two shepherds on one PR. Start one background worker in an
   isolated worktree (or a workspace agent the adapter names) that runs
   `pr-shepherd <owner>/<name>#<N> --until-terminal` and reruns it after every result except CANCEL
   and ESCALATE: TRIAGE means fix and rerun; READY or a quota warning means rerun after the printed
   delay; MERGE means the worker never merges, it reports the PR mergeable and stops. For a stack,
   use `pr-shepherd stack`. Record the handoff (PR, head, worker id, time) in `shepherds`. Nothing
   waits on the worker; on ESCALATE it reports back and the loop escalates. Remove the entry when
   the worker stops. Before any push to an armed PR, the worker or loop runs
   `gh pr merge <N> --repo <owner>/<name> --disable-auto` and confirms `autoMergeRequest` is now
   null; if disarming fails, it does not push and reports instead. After the push it requests a new
   final review (the label again, as in step 5). A later sweep re-arms only when
   `vouchington-reviewer status` exits 0 for the new head.
8. **Verify and report.** `gh pr view <N> --repo <owner>/<name> --json
   isDraft,autoMergeRequest,state`. Report per PR: ready, steered, auto-merge (armed, no,
   manual-verification-required, awaiting-final-review, unavailable), shepherd (local or no), and the reason for any `no`.

The loop never posts `/shepherd` to itself: `/shepherd` is how another agent delegates a PR to it.
