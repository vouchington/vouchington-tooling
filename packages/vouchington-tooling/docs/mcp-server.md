# MCP server

`vouchington mcp` serves the [agent-blackboard](../README.md#validated-feedback-and-delivery)
journal operations to an agent over stdio (Model Context Protocol). An agent passes the markdown as
a tool argument; there is no temp file, `--file`, or replay command. The server builds on the
existing `vouchington-tooling/agent-blackboard` exports and adds no provider protocol.

Phase 1 of [vouchington-tooling#324](https://github.com/vouchington/vouchington-tooling/issues/324)
covers the journal, outbox, session, and snapshot tools below. Retrospective and pull request tools
are later phases.

## Install

Install the server once per machine, not per repository. It needs these packages installed next to
`vouchington-tooling`. `agent-blackboard` and `@modelcontextprotocol/sdk` are optional peer
dependencies, so nothing else in the CLI requires them:

```bash
pnpm add -D vouchington-tooling agent-blackboard@^0.6.0
pnpm add -D @modelcontextprotocol/sdk zod
```

`zod` is required by the SDK. Both `agent-blackboard` and the SDK are resolved from the server's own
install, relative to this package's module, never from the worktree a tool call names, so
repositories do not need to depend on `agent-blackboard`. When either is missing, `vouchington mcp`
writes a message naming the package to stderr and exits with status 1.

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

| Tool              | Arguments besides `sessionId` and `worktree`                                                                                                                                       | Returns                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `journal_append`  | `parentSessionId`, `agent`, `version`, `mode` (`interactive` or `autonomous`), `markdown`, `sourceEventId`, `workOutcome`, `repositories`, `feedbackCoverage`, optional `category` | `sessionId`, `timestamp`, delivery `status` (`delivered` with a verified receipt, or `pending`), `pendingCount`, `worktreePendingCount` |
| `journal_entries` | none                                                                                                                                                                               | `sessionId` and `entries`, every entry oldest first                                                                                     |
| `outbox_status`   | none                                                                                                                                                                               | `sessionId`, `status`, `pendingCount`, `worktreePendingCount`                                                                           |
| `outbox_flush`    | none                                                                                                                                                                               | `sessionId`, `status`, `pendingCount`, `worktreePendingCount`, `deliveredCount`                                                         |
| `session_ensure`  | `parentSessionId`, `agent`, `version`                                                                                                                                              | `sessionId`, `status` (`created` or `exists`), `archived`                                                                               |
| `snapshot_export` | optional `agent`, `version`, `parentSessionId`, `data`, `dataArrayContains`, `inactiveForHours`                                                                                    | `sessionId`, `path`, `counts`, `checksum`, `manifest`, `cleanupToken`                                                                   |
| `session_archive` | none                                                                                                                                                                               | `sessionId`, `archived: true`                                                                                                           |

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
`pendingCount` and `worktreePendingCount` report what remains. A record that cannot be delivered, for
example after an `event-conflict`, stays in the count of the session that wrote it. Flushing an empty
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

## Worktree validation

`worktree` is checked on every call. It must be an absolute path that, after resolving symlinks,
equals the top level of a git worktree, that is, what `git rev-parse --show-toplevel` prints when
run in it. Any git worktree on the machine is accepted, including one of a repository unrelated to
the launch directory, so the tools can act on every checkout the user can reach. Worktrees created
after launch are accepted and removed ones are refused. Rejected: a subdirectory of a worktree, a
relative or nonexistent path, and a directory that is not in a git worktree. Git runs without
`GIT_*` variables, so `GIT_DIR` cannot redirect the check.

When `worktree` is omitted, the launch directory's worktree top level is used if the launch
directory is inside one, and it is validated like any explicit path. If the server was launched
outside a git worktree, the call fails with a tool error asking for an explicit `worktree`.

## Registering the server

The commands below run `vouchington` from the repository's own `node_modules`, so a fresh worktree
uses the version its lockfile pins. Set the blackboard credentials in the environment the harness
gives the server.

Claude Code, `.mcp.json`:

```json
{
  "mcpServers": {
    "vouchington-tooling": {
      "command": "bash",
      "args": ["-c", "exec \"$(git rev-parse --show-toplevel)/node_modules/.bin/vouchington\" mcp"]
    }
  }
}
```

Codex, `.codex/config.toml`:

```toml
[mcp_servers.vouchington-tooling]
command = "bash"
args = ["-c", "exec \"$(git rev-parse --show-toplevel)/node_modules/.bin/vouchington\" mcp"]
default_tools_approval_mode = "approve"
required = false
```

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
