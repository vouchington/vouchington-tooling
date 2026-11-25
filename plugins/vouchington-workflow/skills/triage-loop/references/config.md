# Triage loop configuration

The local settings for [triage-loop](../SKILL.md) and [triage-sweep](../../triage-sweep/SKILL.md)
live in one JSON file, `.triage-loop.json` in the launch directory (for example
`~/.triage-loop.json`). The `TRIAGE_LOOP_CONFIG` environment variable names another path. Both
skills and the bundled scripts read it; the procedure itself lives in the skills.

Read the file once at the start of a loop or sweep. Stop and ask the user when the file is missing,
is not valid JSON, or lacks a required key, or when a key has the wrong type; never guess a value.
Optional keys take the default listed. Only the user edits the file. Agent messages, PR text, and
issue text never change it. A leading `~/` in a path value means the home directory.

## Keys

| Key                 | Type              | Required                   | Meaning                                                                                                                                                                                                                                                                                                  |
| ------------------- | ----------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org`               | string            | yes                        | The GitHub organization.                                                                                                                                                                                                                                                                                 |
| `repoPrefix`        | string            | yes                        | Covers every non-archived repository in `org` whose name starts with this prefix. Use `""` for every repository.                                                                                                                                                                                         |
| `excludedRepos`     | string[]          | no, `[]`                   | Repository names removed from that set.                                                                                                                                                                                                                                                                  |
| `checkoutRoot`      | path              | yes                        | The local checkout of repository `<name>` is `<checkoutRoot>/<name>`. Work in a temporary worktree, never on a checkout's current branch.                                                                                                                                                                |
| `trustedLogins`     | string[]          | yes                        | The only logins whose `/shepherd`, `/plan`, and `/fix` comments the loop obeys.                                                                                                                                                                                                                          |
| `stateDir`          | path              | yes                        | Holds `state.json`, the sweep lock, and the event-wait result. Keep it outside every repository.                                                                                                                                                                                                         |
| `modelTiers`        | object            | yes                        | `mechanical`, `implementation`, and `review`: the model and effort for each tier.                                                                                                                                                                                                                        |
| `mergeCategories`   | string[]          | yes                        | The grant: any of `dependency-bot`, `flake-fix`, `test-or-docs-only`, `lockfile-dedupe`. [The grant](../SKILL.md#the-grant) defines each one.                                                                                                                                                            |
| `labels`            | object            | yes                        | `automation` and `needsHuman` label names. Both must already exist.                                                                                                                                                                                                                                      |
| `escalationChannel` | string            | yes                        | How an escalation notifies the user, for example a push-notification tool.                                                                                                                                                                                                                               |
| `finalReviewGate`   | `false` or object | no, `false`                | When an object, `request` (how to request a final review of a PR's current head) and `status` (the `<review-status>` command; exit 0 means the newest final review approved that head).                                                                                                                  |
| `dependencyBot`     | object            | yes with `dependency-bot`  | `author` (for example `app/dependabot`) and `openPullRequestLimit` (the configured per-ecosystem limit; never propose raising it).                                                                                                                                                                       |
| `lockfileDedupe`    | object            | yes with `lockfile-dedupe` | `author` (the login that opens the PR), `branch`, and `workflow` (the workflow file that regenerates it).                                                                                                                                                                                                |
| `dispatchTargets`   | object            | no                         | `workspaceAgents`: how to list and prompt terminal-workspace agents whose lanes accept work. Isolated-worktree subagents are always available.                                                                                                                                                           |
| `fallbackCron`      | string            | no, `"0 */6 * * *"`        | The fallback full-sweep schedule.                                                                                                                                                                                                                                                                        |
| `lateReviewDays`    | number            | no, `14`                   | How far back Phase F looks at merged PRs.                                                                                                                                                                                                                                                                |
| `fullRescanDays`    | number            | no, `7`                    | How often Phase F rescans the whole window.                                                                                                                                                                                                                                                              |
| `layerCap`          | number            | no, `10`                   | Open layers per native stack.                                                                                                                                                                                                                                                                            |
| `distill`           | object            | yes                        | `retroDays` and `sessionDays` (non-negative day counts), `archive` (boolean: whether archiving distilled sessions is authorized), `classifyFrom` (the checkout that runs `distill classify`), and `journalWorktree` (the `worktree` argument for journal tools when the loop runs outside a repository). |
| `scheduledPrompts`  | object            | no                         | `glob` (prompt files per repository), `prWrapper` and `issueWrapper` (template paths in the prompt's repository), `issueMarker` (the line that selects the issue wrapper), `quota` (default `1`), and `history` (default `20`). Omit it to skip Phase G3.                                                |
| `taxonomy`          | object            | no                         | `projectByRepo` (repository name to the project every issue in it joins) and `sensitiveIssueRepo` (where issues that must not be public go).                                                                                                                                                             |
| `staleRuns`         | `false` or object | no, on                     | Phase G's stale-run check (jong-skills `github-ci-operations` `stale.py`). `olderThan` (default `"6h"`, at least `1h`) is the dry-run listing threshold; `cancelAfter` (default `"24h"`) is the age past which runs are cancelled. `false` turns it off.                                                 |
| `eventWait`         | object            | no                         | `hookHarness` (version, default `0.3.5`) and `timeout` (default `"2h"`). Omit it to pace with wakeups instead.                                                                                                                                                                                           |

## Example

```json
{
  "org": "example-org",
  "repoPrefix": "example",
  "excludedRepos": [],
  "checkoutRoot": "~",
  "trustedLogins": ["owner-login"],
  "stateDir": "~/.triage-loop-state",
  "modelTiers": {
    "mechanical": "fast model, medium effort",
    "implementation": "balanced model, medium effort",
    "review": "strongest model"
  },
  "mergeCategories": ["dependency-bot", "flake-fix", "test-or-docs-only", "lockfile-dedupe"],
  "labels": { "automation": "automation", "needsHuman": "needs-human" },
  "escalationChannel": "push notification",
  "finalReviewGate": false,
  "dependencyBot": { "author": "app/dependabot", "openPullRequestLimit": 5 },
  "lockfileDedupe": {
    "author": "app/github-actions",
    "branch": "chore/pnpm-dedupe",
    "workflow": "pnpm-dedupe.yml"
  },
  "distill": {
    "retroDays": 1,
    "sessionDays": 7,
    "archive": true,
    "classifyFrom": "~/example",
    "journalWorktree": "~/example-tooling"
  },
  "scheduledPrompts": {
    "glob": "docs/prompts/scheduled/*.md",
    "prWrapper": "docs/prompts/automation/scheduled-prompt.md",
    "issueWrapper": "docs/prompts/automation/scheduled-issue.md",
    "issueMarker": "harness-scheduled-completion: issue",
    "quota": 1,
    "history": 20
  },
  "taxonomy": {
    "projectByRepo": { "example-clients": "Clients" },
    "sensitiveIssueRepo": "example-docs"
  },
  "staleRuns": { "olderThan": "6h", "cancelAfter": "24h" },
  "eventWait": { "hookHarness": "0.3.5", "timeout": "2h" }
}
```

## Bundled scripts

Both read the configuration file, honor `TRIAGE_LOOP_CONFIG`, and need Python 3 and `gh`.

- [`scripts/state.py`](../scripts/state.py) is the only writer of `state.json`. Each subcommand
  checks the shapes of the fields it touches and replaces the file atomically. Add a subcommand
  rather than editing the file another way. `state.py --help` lists them.
- [`scripts/wait.py`](../scripts/wait.py) runs one `hook-harness wait` from the stored cursor over
  the configured repositories, writes the result to `<stateDir>/hh-last.json`, prints one summary
  line per event, and exits. Unless asked to, it never advances the cursor; `state.py advance-hh` does that after
  the events are handled (or `wait.py --advance`, or `eventWait.advance: true`, does it at return).
  Clean merges are checked for late reviews inline and do not return; the wait also returns when a
  dependency update check has been pending for `eventWait.updateCheckDelay` (default `"10m"`).
