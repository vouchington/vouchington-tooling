# MCP server

`vouchington mcp` serves the [agent-blackboard](../README.md#validated-feedback-and-delivery)
journal operations to an agent over stdio (Model Context Protocol). An agent passes the markdown as
a tool argument; there is no temp file, `--file`, or replay command. The server builds on the
existing `vouchington-tooling/agent-blackboard` exports and adds no provider protocol.

Phase 1 of [vouchington-tooling#324](https://github.com/vouchington/vouchington-tooling/issues/324)
covers the journal, outbox, session, and snapshot tools below. Phase 2 adds the retrospective tools
and the policy contract they run. Pull request tools are a later phase.

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

## CLI fallback

MCP is the supported path. If it is unavailable, restore it first as the blackboard skill describes.
As a last resort, use `vouchington agent-blackboard journal append|entries|flush|status` as described
there; sandboxed Claude Code and Codex withhold the token, so it can only retain records in the
outbox the server later flushes. Record the fallback and delivery status in the journal and tell the human. The CLI resolves its
client from its own installation, so install `agent-blackboard` alongside that trusted CLI.
Run the script with a verified absolute `node` and a cleared environment (`env -i`), never through
its `#!/usr/bin/env node` line, which takes `node` from a possibly repository-controlled `PATH`.
A missing MCP connection does not waive persistence or readback requirements.

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

| Tool                  | Arguments besides `sessionId` and `worktree`                                                                                                                                             | Returns                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `journal_append`      | `parentSessionId`, `agent`, `version`, `mode` (`interactive` or `autonomous`), `markdown`, `sourceEventId`, `workOutcome`, `repositories`, `feedbackCoverage`, optional `category`       | `sessionId`, `timestamp`, delivery `status` (`delivered` with a verified receipt, or `pending`), `pendingCount`, `worktreePendingCount`          |
| `journal_entries`     | none                                                                                                                                                                                     | `sessionId` and `entries`, every entry oldest first                                                                                              |
| `outbox_status`       | none                                                                                                                                                                                     | `sessionId`, `status`, `pendingCount`, `worktreePendingCount`, `rejectedCount`, `worktreeRejectedCount`                                          |
| `outbox_flush`        | none                                                                                                                                                                                     | `sessionId`, `status`, `pendingCount`, `worktreePendingCount`, `rejectedCount`, `worktreeRejectedCount`, `deliveredCount`, `rejected` (when any) |
| `session_ensure`      | `parentSessionId`, `agent`, `version`                                                                                                                                                    | `sessionId`, `status` (`created` or `exists`), `archived`                                                                                        |
| `retrospective_check` | optional `sourceEventId`                                                                                                                                                                 | `sessionId`, `saved`, `entries` (`sourceEventId`, `timestamp`, `issues`, `prs` of each retrospective, oldest first)                              |
| `retrospective_save`  | `parentSessionId`, `agent`, `version`, `mode`, `workOutcome`, `feedbackCoverage`, exactly one of `markdown` or `compose`, optional `repositories`, `sourceEventId`, `category`, `dryRun` | as `journal_append` plus `policy.warnings`; with `dryRun`, `markdown` and `policy.warnings`                                                      |
| `snapshot_export`     | optional `agent`, `version`, `parentSessionId`, `data`, `dataArrayContains`, `inactiveForHours`                                                                                          | `sessionId`, `path`, `counts`, `checksum`, `manifest`, `cleanupToken`                                                                            |
| `session_archive`     | none                                                                                                                                                                                     | `sessionId`, `archived: true`                                                                                                                    |

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
`storedVersion`, in `journal_append` and in `vouchington agent-blackboard journal append`. A
different `parentSessionId` or `agent` is an `identity-conflict`, and the error names each
differing field with its stored and supplied value, for example
`identity-conflict: agent stored "claude", supplied "codex"`.

`journal_entries` returns `{ sessionId, entries }`. Each entry is exactly what the `agent-blackboard`
client returns (`sessionId`, `createdAt`, `data`), so `data` keeps its envelope fields such as
`repositories`, `sourceEventId`, `workOutcome`, and `feedbackCoverage`. Entries of every type come
back, including `retrospective` and legacy entries without an envelope. The client documents no
order, so they are sorted stably by `createdAt`, oldest first. An empty session returns
`entries: []`. `vouchington agent-blackboard journal entries` still prints journal markdown only.

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
entries whose envelope `type` is `retrospective`. A session that was never created (the blackboard
answers 404) reports `saved: false`.

`retrospective_save` builds a `retrospective` envelope and writes it exactly as `journal_append`
does (same receipt, `pendingCount`, `worktreePendingCount`, outbox rules, and server-owned
timestamp; a `timestamp` argument is rejected). The document comes from `markdown` or from
`compose`, the input of `composeRetrospective` (`narrative`, `date`, `issues`, `prs`,
`description`, `facts`, `transcript`, `tools`, `architecture`, optional `knownSensitiveValues`;
unknown keys are rejected, and the journal audit reads through the server's own client).
`compose.transcript` accepts only `{ sessionId }` (which must equal the call's `sessionId`) or
`{ status, reason }` for an unassessed transcript; `jsonlPath`, `projectsDir`, `codexSessionsDir`,
`grokSessionsDir`, and `cwd` are rejected, and the server reads the transcript from the worktree
and its default session roots. The server's blackboard token, and any `knownSensitiveValues`, are
redacted from the document before the policy sees it or the envelope is stored. Facts commands
are killed after 120 seconds. `dryRun`
runs every check and returns the document without writing.

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
Policy tools also require a server launched inside a repository worktree. Each call runs one named
export in a fresh child process (`bin/policy-runner.mjs`, started with the server's own Node), never
inside the server, with the worktree as its working directory and an environment of only `HOME`,
`PATH` (`/usr/bin:/bin` plus the Node directory), and `GH_TOKEN` / `GITHUB_TOKEN` when the server has
them. Blackboard credentials and `NODE_OPTIONS` are not passed. The child still runs as the
server's user, so this is not a sandbox: on Linux it could read the server's environment from
`/proc/<server pid>/environ`. Treat the policy module as trusted code. After the runner exits, its
whole process group is killed, so nothing it started outlives the call. The runner reads
`{ policyVersion: 1, export, input }` on stdin and writes `{ ok: true, result }` (or
`{ ok: false, error }`) on stdout; a missing export is skipped.

| Export                  | Input                                                                                                                                                                       | Result                                      | Timeout |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------- |
| `validateRetrospective` | `sessionId`, `parentSessionId`, `mode`, `workOutcome`, `feedbackCoverage`, `repositories`, `markdown`, `sourceEventId`, `metadata` (`date`, `issues`, `prs`, `description`) | `{ errors: string[], warnings?: string[] }` | 30 s    |
| `pullRequestDefaults`   | `{}`                                                                                                                                                                        | `{ repositories: string[] }`                | 120 s   |
| `validatePullRequest`   | reserved for the pull request tools                                                                                                                                         | `{ errors: string[], warnings?: string[] }` | 120 s   |

Any `errors` reject the save and write nothing. A non-zero exit, a timeout (reported as
`policy <export> timed out after <N>s`), output over 1 MB, malformed JSON, or a result of the wrong
shape is an error, never a pass.

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
