# Close orphan automation issues

Default scope only. Skip this for narrow-scope runs (explicit numbers, author, label): scanning the
full issue queue would close issues unrelated to the PRs actually triaged.

After the close pass, find open automation issues with no open linked PR: issues whose PR was never
opened, was merged or closed separately, or was just closed in Step 5. Identify automation issues
with the adapter's orphan-issue rules, and exclude the adapter's PR-free backlog label. Those
issues are human-escalation items that are intentionally open without a PR.

```bash
gh issue list --state open --limit 100 --json number,title,labels
```

For each candidate, look for linked open PRs in any repository. `closedByPullRequestsReferences`
sees only PRs using `Closes` or `Fixes`; it is blind to `Refs #N` and `Part of #N`, so cross-check
with a search. Keep each PR's URL and repository, and query by them rather than by bare number.

```bash
gh issue view <ISSUE_N> --json closedByPullRequestsReferences \
  --jq '.closedByPullRequestsReferences[] | {url, repository}'
gh pr view <PR_URL> --json state --jq .state     # the reference's own state field is null
gh search prs --state open "<owner>/<name>#<ISSUE_N>" --json url,repository
gh search prs --state open "<issue-url>" --json url,repository
```

Close the issue only if every check finds no open PR, in this or any other repository:

```bash
gh issue close <ISSUE_N> --repo <owner>/<name> --comment "Closing: orphaned - no open PR is addressing this issue."
```
