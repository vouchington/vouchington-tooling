# MCP server

`vouchington mcp` serves the [agent-blackboard](../README.md#validated-feedback-and-delivery)
journal operations to an agent over stdio (Model Context Protocol). An agent passes the markdown as
a tool argument; there is no temp file, `--file`, or replay command. The server builds on the
existing `vouchington-tooling/agent-blackboard` exports and adds no provider protocol.

Phase 1 of [vouchington-tooling#324](https://github.com/vouchington/vouchington-tooling/issues/324)
covers the journal, outbox, session, and snapshot tools below. Phase 2 adds the retrospective tools
and the policy contract they run. Phase 3 adds the pull request tools.

## Install

Install the server once per machine, in its own dedicated directory, not in a project or a
worktree: `pnpm add` installs into the directory it runs in. The server needs these packages
installed next to `vouchington-tooling`. `agent-blackboard` and `@modelcontextprotocol/sdk` are
optional peer dependencies, so nothing else in the CLI requires them. Pin exact versions; replace
the placeholders with the current releases:

```bash
mkdir -p ~/.local/share/vouchington-mcp
cd ~/.local/share/vouchington-mcp
pnpm init
pnpm add --save-exact vouchington-tooling@<version> agent-blackboard@<version>
pnpm add --save-exact @modelcontextprotocol/sdk@<version> zod@<version>
```

Launch the server by the absolute path into that directory, for example
`/abs/node ~/.local/share/vouchington-mcp/node_modules/vouchington-tooling/bin/vouchington-mcp.mjs`
with `~` expanded to an absolute path (see [Launch](#launch)).

`zod` is required by the SDK. Both `agent-blackboard` and the SDK are resolved from the server's own
install, relative to this package's module, never from the worktree a tool call names, so
repositories do not need to depend on `agent-blackboard`. When either is missing, `vouchington mcp`
writes a message naming the package and the install directory to add it in to stderr and exits with
status 1.

The connection comes from `AGENT_BLACKBOARD_URL` and `AGENT_BLACKBOARD_TOKEN` in the server's
environment. The server never searches for, prints, or mints them.

## Launch

```bash
vouchington mcp
```

The stable entry point, for a harness that launches the server without a shell or a `PATH`
lookup, is this package-relative file:

```text
node_modules/vouchington-tooling/bin/vouchington-mcp.mjs
```

Run it with an absolute Node, for example
`/abs/node /abs/machine/node_modules/vouchington-tooling/bin/vouchington-mcp.mjs`. It is also the
`vouchington-mcp` bin (`node_modules/.bin/vouchington-mcp`) and the `vouchington-tooling/mcp-server/bin`
export. It takes no arguments, skips CLI argument parsing, and is a hand-written plain-JavaScript
file that a CLI refactor does not move; a test pins the path. Both it and `bin/vouchington.mjs` check
the Node version first: on Node older than 24 they print one line to stderr, such as
`vouchington requires Node >=24 (found 18.19.0)`, and exit with status 1.

The command takes no arguments and may be launched with any working directory, including one outside
every git repository (for example `~`). When the working directory is inside a git worktree, that
worktree's top level is the default for tools called without `worktree`. Otherwise those calls fail
with a tool error asking for an explicit `worktree`. stdout carries only protocol frames, and
diagnostics go to stderr.

## Tools

Every tool takes an explicit `sessionId` (`^[A-Za-z0-9._:-]+$`, at most 256 characters) that the
server never infers, and an optional `worktree`. Unknown arguments are rejected. Failures come back
as MCP tool errors (`isError: true`) with an actionable message rather than crashing the server.

| Tool                  | Arguments besides `sessionId` and `worktree`                                                                                                                                                                                                                                                  | Returns                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `journal_append`      | `parentSessionId`, `agent`, `version`, `mode` (`interactive` or `autonomous`), `markdown`, `sourceEventId`, `workOutcome`, `repositories`, `feedbackCoverage`, optional `category`                                                                                                            | `sessionId`, `timestamp`, delivery `status` (`delivered` with a verified receipt, or `pending`), `pendingCount`, `worktreePendingCount`          |
| `journal_entries`     | none                                                                                                                                                                                                                                                                                          | `sessionId` and `entries`, every entry oldest first                                                                                              |
| `outbox_status`       | none                                                                                                                                                                                                                                                                                          | `sessionId`, `status`, `pendingCount`, `worktreePendingCount`, `rejectedCount`, `worktreeRejectedCount`                                          |
| `outbox_flush`        | none                                                                                                                                                                                                                                                                                          | `sessionId`, `status`, `pendingCount`, `worktreePendingCount`, `rejectedCount`, `worktreeRejectedCount`, `deliveredCount`, `rejected` (when any) |
| `session_ensure`      | `parentSessionId`, `agent`, `version`                                                                                                                                                                                                                                                         | `sessionId`, `status` (`created` or `exists`), `archived`                                                                                        |
| `retrospective_check` | optional `sourceEventId`                                                                                                                                                                                                                                                                      | `sessionId`, `saved`, `entries` (`sourceEventId`, `timestamp`, `issues`, `prs` of each retrospective, oldest first)                              |
| `retrospective_save`  | `parentSessionId`, `agent`, `version`, `mode`, `workOutcome`, `feedbackCoverage`, exactly one of `markdown` or `compose`, optional `repositories`, `sourceEventId`, `category`, `dryRun`, `knownSensitiveValues` (markdown only); or `previewToken` with identity, `mode` and `sourceEventId` | as `journal_append` plus `policy.warnings`; with `dryRun`, `markdown`, `previewToken` and `policy.warnings`                                      |
| `snapshot_export`     | optional `agent`, `version`, `parentSessionId`, `data`, `dataArrayContains`, `inactiveForHours`                                                                                                                                                                                               | `sessionId`, `path`, `counts`, `checksum`, `manifest`, `cleanupToken`                                                                            |
| `snapshot_cleanup`    | `cleanupToken`                                                                                                                                                                                                                                                                                | `sessionId`, `cleaned: true`                                                                                                                     |
| `session_archive`     | none                                                                                                                                                                                                                                                                                          | `sessionId`, `archived: true`                                                                                                                    |

`journal_append` validates the whole feedback envelope with `validateFeedbackEnvelope` before
anything is written, so a missing required field writes nothing. It returns the verified read-back
result of `writeFeedback`. Delivery is at least once. Markdown is limited to 12000 bytes.

The server owns the entry `timestamp`: the tool takes no `timestamp` argument and rejects one, so an
agent cannot fabricate it, and the result returns the timestamp it reports. An event is identified by
`sessionId`, `sourceEventId`, and content; the timestamp is not part of that identity. The server
stamps each attempt with the current time, and the delivery step compares the new attempt with what
the blackboard or the worktree outbox already holds while ignoring only `timestamp`. To retry, repeat
the identical call. A retry of an event that is already stored, or already retained in the outbox,
is the same event: it writes nothing, drops the duplicate retained record, and returns the stored
record's `timestamp` and `receipt`, so repeated retries report the same timestamp, including after a
server restart and when the provider was unreachable for the retry. An outbox record that was
delivered before the retry is recognized the same way when it is flushed, so it drains instead of
blocking. Any difference in the other envelope fields under the same `sessionId` and
`sourceEventId` is an `event-conflict` (or a conflict with the retained unsent record) and writes
nothing. If an autonomous write of the same event lands between the check and the append, both
entries exist, but the report names the earliest stored one and later retries report it again.
Admission freshness (`verifyFreshFeedback`) keeps its stricter rule: any earlier record of the event,
whatever its timestamp, is a conflict.

A session that already exists with a different `version` (an agent upgrade, or a session another
writer created) is not a conflict: the entry is delivered into it and the result reports
`storedVersion`, in `journal_append`. A
different `parentSessionId` or `agent` is an `identity-conflict`, and the error names each
differing field with its stored and supplied value, for example
`identity-conflict: agent stored "claude", supplied "codex"`.

`journal_entries` returns `{ sessionId, entries }`. Each entry is exactly what the `agent-blackboard`
client returns (`sessionId`, `createdAt`, `data`), so `data` keeps its envelope fields such as
`repositories`, `sourceEventId`, `workOutcome`, and `feedbackCoverage`. Entries of every type come
back, including `retrospective` and legacy entries without an envelope. The client documents no
order, so they are sorted stably by `createdAt`, oldest first. An empty session returns
`entries: []`.

`sessionId` on `outbox_status`, `outbox_flush`, and `snapshot_export` only identifies the caller.
The outbox is per worktree, so the results name two counts apart. `pendingCount` is the number of
unsent records of the caller's `sessionId`, and `status` (`empty` or `pending`) follows it.
`worktreePendingCount` is the number of unsent records of every session in the worktree outbox. Both
are 0 in autonomous mode, which has no outbox. `outbox_flush` delivers every retained record in the
worktree, whichever session wrote it, so its `deliveredCount` covers the whole flush while
`pendingCount` and `worktreePendingCount` report what remains. A record that fails transiently
(unavailable, timeout, auth) stays in the count of the session that wrote it. A permanent rejection
(`identity-conflict`, `event-conflict`, `archived-session`), whether it happens on `journal_append`
or during `outbox_flush`, moves the record out of the pending set into the outbox's rejected area,
keeping its content. `rejectedCount` and `worktreeRejectedCount` report those records, and a
corrected retry with the same `sourceEventId` is accepted. `outbox_flush` also returns
`rejected: [{ sourceEventId, diagnostic }]` for what it moved. Flushing an empty
outbox does not create the directory. `snapshot_export` never accepts a destination: the
`agent-blackboard` client chooses a private file and returns its path. `session_archive` is the one
destructive tool; archived metadata is immutable, while entries stay appendable.

### Snapshot cleanup

`snapshot_export` writes a private file in the OS temp directory, and `snapshot_cleanup` is the only
way to delete it through the server. It was chosen over cleanup inside `session_archive` because
the exporting session and the archived sessions differ during distillation, and cleanup must run
whether or not archiving happened. Call it as a finally step after processing, on success and on
failure.

- **No caller-chosen path.** The tool takes only `cleanupToken` (`path`, `directory`, and `receipt`
  are unsupported arguments). The server records the export's file path itself, plus a partition
  directory and its signed receipt when the client reports both, and cleans exactly that record.
  When the client's export carried its own cleanup capability, the server keeps it (never
  returning it) and cleans through the client's `cleanupSnapshotPartitions`, so the client's
  ownership marker goes with the file; otherwise it uses the in-tree `cleanupSnapshotPartitions`.
- **Server-minted, bound token.** `snapshot_export` replaces the client's `cleanupToken` with 32
  random bytes the server generates, recorded with the caller's `sessionId` and resolved `worktree`.
  The binding is checked before any filesystem call.
- **Single use.** A successful cleanup spends the token; a repeat fails as unknown and deletes
  nothing. The record is taken synchronously, so concurrent calls cannot both clean.
- **Failure modes.** An unknown, forged (including a path used as a token), spent, other-session, or
  other-worktree token fails with one message and deletes nothing; a mismatched caller does not spend
  the owner's token. If the cleanup itself fails, the token stays valid and the error carries the
  reason, including the retained tombstone path when a partition directory was half removed, so the
  same call can retry. A file that is already gone counts as cleaned.
- **Server restart.** Bindings are in memory only. After a restart every earlier token is unknown, so
  the file is left for the operating system to reap from its temp directory; run the distill pass
  again to export a fresh snapshot. The registry also remembers at most 256 exports and forgets the
  oldest first.

The outbox lives at `<worktree>/.local/blackboard-outbox` and is used only in interactive mode.
Autonomous mode forbids a filesystem outbox, so a failed delivery is an error.

### Tool names by harness

Each harness names the same tools differently, and some load them on demand. The names in this page
are the bare tool names; find yours by searching for `journal_append` before concluding the server
is unavailable.

| Harness     | `journal_append` is called                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| Claude Code | `mcp__vouchington-tooling__journal_append`                                                                               |
| Codex       | `mcp__vouchington_tooling__journal_append` (the server name's hyphen becomes an underscore)                              |
| Cursor      | deferred: look it up with `GetDynamicTools` and call it with `CallDynamicTool` under the `vouchington-tooling` namespace |
| Grok        | `vouchington-tooling__journal_append`, found with `search_tool` and called with `use_tool`                               |

The server sends the same list in its MCP `instructions`, so a harness that surfaces server
instructions shows it to the agent.

## Retrospective tools and the policy contract

`retrospective_check` reads the session through the same client as `journal_entries` and reports the
entries whose envelope `type` is `retrospective`. A schema-versioned entry counts only when its
envelope passes `validateFeedbackEnvelope`; a malformed one is not saved, while an unversioned legacy
entry is still accepted. A session that was never created (the blackboard
answers 404) reports `saved: false`.

`retrospective_save` builds a `retrospective` envelope and writes it exactly as `journal_append`
does (same receipt, `pendingCount`, `worktreePendingCount`, outbox rules, and server-owned
timestamp; a `timestamp` argument is rejected). The document comes from `markdown` or from
`compose`, the input of `composeRetrospective` (`narrative`, `date`, `issues`, `prs`,
`description`, `facts`, `transcript`, `tools`, `architecture`, optional `knownSensitiveValues`;
unknown keys are rejected, and the journal audit reads through the server's own client).
`compose.transcript` accepts only `{ sessionId?, harnessSessionId? }` (`sessionId` must equal the
call's `sessionId`) or `{ status, reason }` for an unassessed transcript. The transcript is found by
`harnessSessionId`, the harness's own session UUID, else by the call's `sessionId` when that is a
UUID; otherwise the call fails rather than reporting the transcript unavailable. When the server's environment names its harness session (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, and so on), only that session's transcript is read (after `/clear` or a thread switch, reconnect the server, or pass `{ status, reason }`); `jsonlPath`, `projectsDir`, `codexSessionsDir`,
`grokSessionsDir`, and `cwd` are rejected, and the server reads the transcript from the worktree
and its default session roots. The server's blackboard token, and any `knownSensitiveValues`, are
redacted from the document before the policy sees it or the envelope is stored. Facts commands
are killed after 120 seconds. `compose.facts` takes `pr`, `branch`, `noPr`, or `{ status, reason }`;
`repo` is rejected, so the server's GitHub token never queries a repository other than the
worktree's. Facts run `git` and `gh` in the worktree as the server's user, honoring its
repository configuration (which can select helpers that run code), so the worktree, including
`.git/config`, must be as trusted as the policy module. `dryRun`
runs every check and returns the document without writing, plus a `previewToken`.

`knownSensitiveValues` (each at least 4 characters) is also accepted beside `markdown`, and
redacts the markdown, `category` and `feedbackCoverage` just as `compose.knownSensitiveValues`
does; with `compose`, pass it inside `compose`. The `previewToken` is 32 random bytes (base64url),
opaque, single use, and held only in server memory: a restart drops every token, and the registry
keeps the 32 most recent. It is bound to the `sessionId`, `parentSessionId`, `mode`, the resolved worktree, the `sourceEventId`
and the exact redacted content. Save it by calling `retrospective_save` again with the identity,
the same `parentSessionId`, `mode`, `sourceEventId` and `previewToken`, and none of `markdown`, `compose`,
`workOutcome`, `feedbackCoverage`, `repositories`, `category`, `knownSensitiveValues` or `dryRun`.
The server stores exactly the previewed content (so a sensitive value never has to be sent
again), mints a new timestamp, and does not run the policy again. An unknown, spent, restarted or
mismatched token is one error and the dry run must be repeated; a mismatch does not spend the
token, and neither does a failed write.

The document must open with the front matter `composeRetrospective` writes: lines of
`key: <JSON value>` between two `---` lines. Recognized keys are `date`, `issues`, `prs` (required),
`session_id`, `description`, `work_outcome`, `feedback_coverage` (`status`, `sources`,
`droppedCount`), and `repositories`; anything else, a duplicate, or a malformed line is rejected.
`session_id`, `work_outcome`, `feedback_coverage`, and `repositories` must equal the arguments when
present. `repositories` resolves from the argument, else the front matter, else the policy's
`pullRequestDefaults()` result, else an error, and is stored sorted, deduplicated, and lowercase.
The default `sourceEventId` is `retrospective-<sessionId>`, or `retrospective-<sha256 hex of the
sessionId>` when that would exceed 256 bytes. Re-saving identical content returns the
stored receipt and timestamp. Changed content under the same `sourceEventId` is an
`event-conflict`; a revision needs a new `sourceEventId`. `compose` regenerates the document from
the live journal and repository, so repeating a `compose` call is not a retry: when an interactive
save is retained in the outbox, deliver it with `outbox_flush`.

### Policy module

The consumer's root `package.json` may declare
`"vouchington-tooling": { "policy": "dev/agent-policy.mts" }`. The path must be relative and, after
resolving symlinks, stay inside the worktree. Without a declaration the policy checks are skipped.
Policy tools also require a server launched inside a repository worktree on macOS or Linux (they
refuse to run on Windows, where the server cannot reap a policy's descendants by process group),
and refuse to run when `AGENT_BLACKBOARD_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN` is set to a value
shorter than four characters, which could not be redacted from policy output. Each call runs one named
export in a fresh child process (`bin/policy-runner.mjs`, started with the server's own Node), never
inside the server, with the worktree as its working directory and an environment of only `HOME`,
`PATH` (`/usr/bin`, `/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, the Node directory, and the
directory of the first `gh` on the server's `PATH`, deduplicated), and `GH_TOKEN` / `GITHUB_TOKEN` when the server has
them. Blackboard credentials and `NODE_OPTIONS` are not passed. The child still runs as the
server's user, so this is not a sandbox: on Linux it could read the server's environment from
`/proc/<server pid>/environ`. Treat the policy module as trusted code. After the runner exits, its
whole process group is killed, so nothing it started outlives the call. The runner reads
`{ policyVersion: 1, export, input }` on stdin and writes `{ ok: true, result }` (or
`{ ok: false, error }`) on stdout; a missing export is skipped.

| Export                  | Input                                                                                                                                                                       | Result                                                         | Timeout |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------- |
| `validateRetrospective` | `sessionId`, `parentSessionId`, `mode`, `workOutcome`, `feedbackCoverage`, `repositories`, `markdown`, `sourceEventId`, `metadata` (`date`, `issues`, `prs`, `description`) | `{ errors: string[], warnings?: string[] }`                    | 30 s    |
| `pullRequestDefaults`   | `{}` from `retrospective_save`; `{ title, base, relatedIssues }` from `pr_create`                                                                                           | `{ repositories?, labels?, milestone?, project? }` (an object) | 120 s   |
| `validatePullRequest`   | `title`, `body`, `base`, `head`, the trusted `mode`, `noSourceIssue` when given, and `pr` when set                                                                          | `{ errors: string[], warnings?: string[] }`                    | 120 s   |

Any `errors` reject the save and write nothing. A non-zero exit, a timeout (reported as
`policy <export> timed out after <N>s`), output over 1 MB, malformed JSON, or a result of the wrong
shape is an error, never a pass.

## Pull request tools

`vouchington mcp` serves `pr_validate`, `pr_create` and `pr_update` besides the journal and
retrospective tools. All three take `sessionId` (required) and `worktree` (optional), need a server
launched inside a repository worktree (they run the checkout policy), and share this structured
input: `title` (single line, at most 256 characters), `summary`, `impact`, `relatedIssues`
(`[{ number, relation: "closes" | "refs", reason, repository? }]`, may be empty; the optional
`repository` is a single `owner/name` and renders the line as lowercase `owner/name#N`), optional
`noSourceIssue` (`{ reason }`, see below), `details` (string array), `base` (default `main`),
optional `agent`, optional
`model`, optional `mode` (`interactive` | `autonomous`) and `workspaceSetup`. `pr_update` also
requires `pr`; `pr_validate` accepts an optional `pr`.

### Trusted mode

The mode the policy sees is derived by the server from its own launch environment, never from the
caller. It fails closed: when any automation marker is set to something other than an empty
string, `0` or `false` (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `BUILDKITE`, `CIRCLECI`,
`JENKINS_URL`, `TF_BUILD`, `CODEBUILD_BUILD_ID`, `VOUCHINGTON_AUTOMATION`), the mode is
`autonomous` whatever the caller passes. `CLAUDE_CODE_SESSION_ATTENDED` set to exactly `0` (Claude
Code's marker for an unattended `claude -p` run, inherited by MCP servers) also means `autonomous`;
a missing value or `1` never does. This list is a superset of the downstream check it replaces,
which was exactly `GITHUB_ACTIONS === 'true' || CI === 'true'`. Otherwise the mode is `interactive`. The optional `mode`
argument can only narrow `interactive` to `autonomous` (it never widens), so an autonomous run
cannot unlock an interactive-only policy exception. The policy child receives no env markers, so it
relies on this value.

### Agent provenance

The `Agent:` line is derived by the server, never taken from the caller. The agent is the harness
that launched the server: `CODEX_THREAD_ID` (codex), `CLAUDECODE=1` or `CLAUDE_CODE_SESSION_ID`
(claude), `CURSOR_AGENT` or `CURSOR_SESSION_ID` (cursor), `GROK_AGENT`, `GROK_HOOK_EVENT` or
`GROK_SESSION_ID` (grok), in that order; failing those, the MCP client's `initialize`
`clientInfo.name` when it contains one of those names. The server has no source for the model.
`agent` is optional: a value naming the derived agent is ignored, any other value is rendered as
`(caller-claimed agent: <value>)`, and `model` as `(caller-claimed model: <value>)`. When no agent
is derivable the line says `unknown`. Making `agent` optional is compatible with existing callers,
which may keep sending it.

### Pull requests with no source issue

Pass `noSourceIssue: { reason }` (a single line) with an empty `relatedIssues`, or with a
`relatedIssues` whose every entry is `refs`; a `closes` entry beside it is rejected. The Related
issues section then holds the generic statement `- No source issue — <reason>` instead of `- None`,
preceded by the `- Refs … — <reason>` lines when there are any (the statement is always the last
line). A policy may replace the statement by
exporting `renderNoSourceIssue({ reason })`, returning a non-empty string (30 s). The field also
reaches `validatePullRequest` (with the trusted `mode`, so the policy can apply an interactive-only
rule) and `pullRequestDefaults`.

### Rendering

```
## Summary

<summary>

## Impact

<impact>

## Related issues

- Closes #N — <reason>      (or "Refs #N"; owner/name#N with `repository`; "- None" when empty;
                             "- No source issue — <reason>" for noSourceIssue, rendered
                             after any Refs lines)

## Details

<details joined by blank lines>

Workspace setup: <workspaceSetup>
Agent: <derived agent | unknown>[ (caller-claimed ...)] session <sessionId>
Device: <os user>@<lowercased hostname>
Worktree: <path after "/worktrees/", "main" for the main worktree, else the directory name>
```

The head branch is the worktree's current branch (for `pr_validate` with `pr`, the live pull
request's head, which may equal `base` for a fork); otherwise a detached HEAD, or a head equal to `base`, is rejected. The body must stay within GitHub's 65536 characters. `pr_create` sees no stack membership,
so a consumer policy may reject any `base` other than the default branch; create stacked layers
with the repository's stack tooling instead.

### Tools

- `pr_validate` (read-only): renders the body, runs the policy `validatePullRequest({ title, body,
  base, head, mode, noSourceIssue?, pr? })` export and returns `{ body, errors, warnings }`. With
  `pr`, the live body is read (never written) so its Shepherd Journal is preserved as in
  `pr_update`. The liveness checks of `pr_update` do not apply: any state (merged or closed
  included) and any head are accepted, and the policy sees the pull request's own head and base.
- `pr_create` (additive): renders and validates (errors block), then calls the policy
  `pullRequestDefaults({ title, base, relatedIssues, noSourceIssue? })` export for optional `labels`, `milestone`
  and `project`. It checks the head is pushed and current, writes the body to a mode 0600 temp file
  (removed afterwards) and runs `gh pr create --draft` with the labels, `--milestone` and
  `--project`. Returns `{ number, url, warnings }`.
- `pr_update` (mutating): reads `gh pr view <pr> --json body,headRefName,headRefOid,baseRefName,state`,
  rejects a pull request that is not `OPEN` or whose head is neither the worktree branch nor the
  worktree `HEAD` commit (an alias branch at the live head SHA is accepted and the live head name is
  used), and validates
  against the live base (an explicit `base` must equal it). It renders, appends the live Shepherd
  Journal (a `<details><summary>Shepherd Journal</summary>` block, or a legacy `## Shepherd Journal`
  section to the next H2 or the end; examples in fenced code blocks are ignored), validates with
  `pr` set (errors block), then runs `gh pr edit <pr> --title --body-file`. More than one journal
  in the live body, one in the rendered fields, an unclosed journal, or rendered fields that leave
  a code fence open are rejected rather than guessed. Just before the edit the live body is read
  again, and the update aborts if its journal changed meanwhile. Nothing else is carried over from
  the live body. Returns `{ number, url, warnings }`.

Every field is redacted of `AGENT_BLACKBOARD_TOKEN`, `GH_TOKEN`, and `GITHUB_TOKEN` before
rendering, the policy, or `gh`; a worktree branch name containing one is rejected. `title` and
`workspaceSetup` must be single lines, and the title is limited to 256 characters after redaction.

### gh access

`gh` is found in the absolute directories of the server's `PATH` (relative entries are skipped,
since they would resolve inside the target worktree), else at `/opt/homebrew/bin/gh`, `/usr/local/bin/gh` or
`/usr/bin/gh`; otherwise the tool fails with "gh CLI not found on PATH; install gh or add it to the
server's PATH". It runs with the worktree as its working directory and the server environment
without `AGENT_BLACKBOARD_URL`, `AGENT_BLACKBOARD_TOKEN`, and `GH_REPO` (which would point it at
another repository), and each call is killed after 120 seconds.

## Worktree validation

`worktree` is checked on every call. It must be an absolute path that, after resolving symlinks,
equals the top level of a git worktree, that is, what `git rev-parse --show-toplevel` prints when
run in it. When the server was launched inside a repository, the real path must also equal one of
the `worktree` entries of `git worktree list --porcelain` run in the launch root (the primary
worktree or a linked one), so an unrelated repository is refused. A server launched outside any
repository accepts the top level of any git worktree for the journal tools, but refuses the policy
tools. Worktrees created after launch are accepted and removed ones are refused. Rejected: a subdirectory of a worktree, a
relative or nonexistent path, and a directory that is not in a git worktree. Git runs without
`GIT_*` variables, so `GIT_DIR` cannot redirect the check, and with `LC_ALL=C` and no `LANGUAGE`, so
its "not a git repository" diagnostic is never translated.

`worktree` only chooses where the outbox lives. It is not a trust boundary for loading code: the
server never imports modules from it. The policy tools run the declared module only in a child
process without blackboard credentials, as described above.

When `worktree` is omitted, the launch directory's worktree top level is used if the launch
directory is inside one, and it is validated like any explicit path. If the server was launched
outside a git worktree, the call fails with a tool error asking for an explicit `worktree`.

## Registering the server

Register the machine-wide installation from [Install](#install) at user level, with absolute paths.
Never check a registration into a repository: it names a path and a Node that exist only on your
machine, and every worktree inherits it from your user config. Replace `/abs/node` with the absolute
path of a Node >= 24 and `/home/you` with your home directory (neither file expands `~`). Set the
blackboard credentials in the environment you start the harness from.

Claude Code, `mcpServers` in `~/.claude.json`:

```json
{
  "mcpServers": {
    "vouchington-tooling": {
      "command": "/abs/node",
      "args": [
        "/home/you/.local/share/vouchington-mcp/node_modules/vouchington-tooling/bin/vouchington-mcp.mjs"
      ]
    }
  }
}
```

Codex, `~/.codex/config.toml`:

```toml
[mcp_servers.vouchington-tooling]
command = "/abs/node"
args = [
  "/home/you/.local/share/vouchington-mcp/node_modules/vouchington-tooling/bin/vouchington-mcp.mjs",
]
env_vars = ["AGENT_BLACKBOARD_URL", "AGENT_BLACKBOARD_TOKEN"]
default_tools_approval_mode = "approve"
required = false
```

`env_vars` forwards those variables from Codex's own environment. Codex does not expand `${VAR}`
inside `env`, so do not write the credentials there.

Approving every tool of the server at once:

- Claude Code permission rule: `mcp__vouchington-tooling__*`
- Cursor permission rule: `Mcp(vouchington-tooling:*)`
- Codex: `default_tools_approval_mode = "approve"` above

Cursor also asks each user to approve loading a project server, separately from the permission rule
above, and the rule does not replace it. Approve it once, interactively, with
`cursor-agent mcp enable vouchington-tooling`. Headless `cursor-agent -p` does not keep that
approval: pass `--approve-mcps` on every run.

## What is verified

Covered by this package's tests: the tool list and schemas, every tool's success and rejection
paths against a faked blackboard client, the worktree gate against real temporary git repositories,
an in-process client and server round trip through the SDK's in-memory transport, and a spawned
`vouchington mcp` process driven over real stdio.

The per-harness tool names and the Cursor approval steps come from headless smoke runs of the
server in each harness, not from this package's tests.

Not verified, and tracked as the unchecked Phase 0 checklist in
[#324](https://github.com/vouchington/vouchington-tooling/issues/324): each harness's approval
syntax and whether the rules above take effect, the working directory after entering a worktree,
environment interpolation and credential passing, `gh` authentication, behavior in a freshly
created worktree, and connectivity from automation. Treat the registration snippets and permission
rules as untested per harness until that checklist is complete.
