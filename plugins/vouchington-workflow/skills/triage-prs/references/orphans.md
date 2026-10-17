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

For each candidate, check closing references. `closedByPullRequestsReferences` sees only PRs using
`Closes` or `Fixes`; it is blind to `Refs #N` and `Part of #N`, so cross-check with a search.

```bash
gh issue view <ISSUE_N> --json closedByPullRequestsReferences \
  --jq '.closedByPullRequestsReferences | map(.number) | .[]'
gh pr view <PR_N> --json state --jq .state          # the reference's own state field is null
gh pr list --state open --search "#<ISSUE_N>" --json number,title --jq '.[] | .number'
```

Close the issue only if both checks find no open PR:

```bash
gh issue close <ISSUE_N> --comment "Closing: orphaned - no open PR is addressing this issue."
```
