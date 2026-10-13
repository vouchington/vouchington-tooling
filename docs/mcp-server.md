# MCP server: pull request tools

`vouchington mcp` serves `pr_validate`, `pr_create` and `pr_update` besides the journal and
retrospective tools. All three take `sessionId` (required) and `worktree` (optional), need a server
launched inside a repository worktree (they run the checkout policy), and share this structured
input: `title` (single line, at most 256 characters), `summary`, `impact`, `relatedIssues`
(`[{ number, relation: "closes" | "refs", reason }]`, may be empty), `details` (string array),
`base` (default `main`), `agent`, optional `model`, `mode` (`interactive` | `autonomous`) and
`workspaceSetup`. `pr_update` also requires `pr`; `pr_validate` accepts an optional `pr`.

## Rendering

```
## Summary

<summary>

## Impact

<impact>

## Related issues

- Closes #N — <reason>      (or "Refs #N"; "- None" when empty)

## Details

<details joined by blank lines>

Workspace setup: <workspaceSetup>
Agent: <agent>[ (<model>)] session <sessionId>
Device: <os user>@<lowercased hostname>
Worktree: <path after "/worktrees/", "main" for the main worktree, else the directory name>
```

The head branch is the worktree's current branch; a detached HEAD, or a head equal to `base`, is
rejected. The body must stay within GitHub's 65536 characters.

## Tools

- `pr_validate` (read-only): renders the body, runs the policy `validatePullRequest({ title, body,
base, head, mode, pr? })` export and returns `{ body, errors, warnings }`. With `pr`, the live
  body is read (never written) so its Shepherd Journal is preserved as in `pr_update`.
- `pr_create` (additive): renders and validates (errors block), then calls the policy
  `pullRequestDefaults({ title, base, relatedIssues })` export for optional `labels`, `milestone`
  and `project`. It checks the head is pushed and current, writes the body to a mode 0600 temp file
  (removed afterwards) and runs `gh pr create --draft` with the labels, `--milestone` and
  `--project`. Returns `{ number, url, warnings }`.
- `pr_update` (mutating): reads `gh pr view <pr> --json body,headRefName`, rejects a head other
  than the worktree branch, renders, preserves the live Shepherd Journal (a
  `<details><summary>Shepherd Journal</summary>` block, or a legacy `## Shepherd Journal` section to
  the next H2 or the end) when the new body has none, validates with `pr` set (errors block), then
  runs `gh pr edit <pr> --title --body-file`. Nothing else is carried over from the live body.
  Returns `{ number, url, warnings }`.

## gh access

`gh` is found on the server's `PATH`, else at `/opt/homebrew/bin/gh`, `/usr/local/bin/gh` or
`/usr/bin/gh`; otherwise the tool fails with "gh CLI not found on PATH; install gh or add it to the
server's PATH". It runs with the worktree as its working directory and the server environment
without `AGENT_BLACKBOARD_URL` and `AGENT_BLACKBOARD_TOKEN`.
