# Close procedure

Applies the rules in `SKILL.md`: explicit `--repo`, reviewed head re-check, the exclusion set,
exhaustive lists, and generated text passed only from files.

## Delete the branch

`gh pr close` does not delete the branch unless asked, and merge-time auto-deletion does not apply
to closes. Read the head branch name as data (`gh pr view <N> --repo <owner>/<name> --json
headRefName`) and pass it to `jq --arg`, never into a shell string. Before deleting, list open PRs
that use the branch as a base or share it as their head:

```bash
gh pr list --repo <owner>/<name> --state open --limit 1000 --json number,title,baseRefName,headRefName \
  | jq --arg b "$BRANCH" '.[] | select(.baseRefName == $b or .headRefName == $b)'
```

Ignore the PR being closed. If any other PR remains, do not delete the branch: deleting a base
closes its dependents, including unreviewed layers, and deleting a shared head breaks the others.
Close without deleting and report the PR and why the branch was kept. Otherwise close with
`gh pr close <N> --repo <owner>/<name> --delete-branch` in place of the plain close in Step 5.

## Linked issues

```bash
gh pr view <N> --repo <owner>/<name> --json closingIssuesReferences \
  --jq '.closingIssuesReferences[] | {number, title, url, repository}'
```

Keep each reference's repository and URL. Close only issues in this repository; skip and report
cross-repository targets. Close an issue only if it appears automation-created under the adapter's
orphan-issue rules. Skip anything that looks human-authored: automation sometimes reuses a
human-tracked issue by adding `Closes #<N>` to a PR body. Skip excluded issues. Before closing,
re-read the issue (`gh issue view <ISSUE_N> --repo <owner>/<name> --json state,labels,title`) and
confirm it is still open and still classified as automation-created; then
apply the [no-open-PR checks](#no-open-pr-checks), excluding the PR just closed.

Write the comment (`Closing alongside PR #<N>: <reason>`) to a file, then:

```bash
gh issue comment <ISSUE_N> --repo <owner>/<name> --body-file <comment-file>
gh issue close <ISSUE_N> --repo <owner>/<name>
```

## Orphan automation issues

Default scope only. Skip this for narrow-scope runs: scanning the full issue queue would close
issues unrelated to the PRs actually triaged.

Find open automation issues with no open linked PR: issues whose PR was never opened, was merged or
closed separately, or was just closed. Identify them with the adapter's orphan-issue rules, exclude
the adapter's PR-free backlog label (intentional human-escalation items), and exclude the exclusion
set. Exhaust the list:

```bash
gh issue list --repo <owner>/<name> --state open --limit 1000 --json number,title,labels
```

Verify the count is below the limit, otherwise page with `gh api --paginate`.

### No-open-PR checks

`closedByPullRequestsReferences` sees only PRs using `Closes` or `Fixes`; it is blind to `Refs #N`
and `Part of #N`. Keep each PR's URL and repository, and query by them rather than by bare number.

```bash
gh issue view <ISSUE_N> --repo <owner>/<name> --json closedByPullRequestsReferences \
  --jq '.closedByPullRequestsReferences[] | {url, repository}'
gh pr view <PR_URL> --json state --jq .state     # the reference's own state field is null
gh search prs --repo <owner>/<name> --state open --limit 1000 "#<ISSUE_N>" --json url,repository
gh search prs --state open --limit 1000 "<owner>/<name>#<ISSUE_N>" --json url,repository
gh search prs --state open --limit 1000 "<issue-url>" --json url,repository
```

Keep the same-repository `#<ISSUE_N>` form alongside the qualified and URL forms, since each only
matches the text it contains. Re-read the issue as above. Close it only if every check finds no open PR, in this or any
other repository, using the comment and close commands above with the text
`Closing: orphaned - no open PR is addressing this issue.`
