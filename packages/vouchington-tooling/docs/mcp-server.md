# MCP server

`vouchington mcp` serves the [agent-blackboard](../README.md#validated-feedback-and-delivery)
journal operations to an agent over stdio (Model Context Protocol). An agent passes the markdown as
a tool argument; there is no temp file, `--file`, or replay command. The server builds on the
existing `vouchington-tooling/agent-blackboard` exports and adds no provider protocol.

Phase 1 of [vouchington-tooling#324](https://github.com/vouchington/vouchington-tooling/issues/324)
covers the journal, outbox, session, and snapshot tools below. Retrospective and pull request tools
are later phases.

## Install

The server needs three packages next to `vouchington-tooling`. The last two are optional peer
dependencies, so nothing else in the CLI requires them:

```bash
pnpm add -D vouchington-tooling agent-blackboard@^0.6.0
pnpm add -D @modelcontextprotocol/sdk zod
```

`zod` is required by the SDK. When the SDK is missing, `vouchington mcp` writes a message naming the
package to stderr and exits with status 1. `agent-blackboard` is resolved from the validated
worktree at call time (`createRequire` on `<worktree>/package.json`), never from this package.

The connection comes from `AGENT_BLACKBOARD_URL` and `AGENT_BLACKBOARD_TOKEN` in the server's
environment. The server never searches for, prints, or mints them.

## Launch

```bash
vouchington mcp
```

The command takes no arguments. Start it inside the repository's git worktree: that repository
defines which worktrees the tools accept. stdout carries only protocol frames, and diagnostics go
to stderr.

## Tools

Every tool takes an explicit `sessionId` (`^[A-Za-z0-9._:-]+$`, at most 256 characters) that the
server never infers, and an optional `worktree`. Unknown arguments are rejected. Failures come back
as MCP tool errors (`isError: true`) with an actionable message rather than crashing the server.

| Tool              | Arguments besides `sessionId` and `worktree`                                                                                                                                                    | Returns                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `journal_append`  | `parentSessionId`, `agent`, `version`, `mode` (`interactive` or `autonomous`), `markdown`, `sourceEventId`, `workOutcome`, `repositories`, `feedbackCoverage`, optional `timestamp`, `category` | `sessionId`, `timestamp`, delivery `status` (`delivered` with a verified receipt, or `pending`) |
| `journal_entries` | none                                                                                                                                                                                            | `sessionId` and `entries`, every entry oldest first                                             |
| `outbox_status`   | none                                                                                                                                                                                            | `sessionId`, `status`, `pendingCount`                                                           |
| `outbox_flush`    | none                                                                                                                                                                                            | `sessionId`, `status`, `pendingCount`, `deliveredCount`                                         |
| `session_ensure`  | `parentSessionId`, `agent`, `version`                                                                                                                                                           | `sessionId`, `status` (`created` or `exists`), `archived`                                       |
| `snapshot_export` | optional `agent`, `version`, `parentSessionId`, `data`, `dataArrayContains`, `inactiveForHours`                                                                                                 | `sessionId`, `path`, `counts`, `checksum`, `manifest`, `cleanupToken`                           |
| `session_archive` | none                                                                                                                                                                                            | `sessionId`, `archived: true`                                                                   |

`journal_append` validates the whole feedback envelope with `validateFeedbackEnvelope` before
anything is written, so a missing required field writes nothing. It returns the verified read-back
result of `writeFeedback`. Delivery is at least once. The envelope includes its timestamp, so when
retrying the same `sourceEventId`, resend the same content and the `timestamp` the first call
returned; the server fixes a default timestamp and returns it for that reason. Markdown is limited
to 12000 bytes.

`journal_entries` returns `{ sessionId, entries }`. Each entry is exactly what the `agent-blackboard`
client returns (`sessionId`, `createdAt`, `data`), so `data` keeps its envelope fields such as
`repositories`, `sourceEventId`, `workOutcome`, and `feedbackCoverage`. Entries of every type come
back, including `retrospective` and legacy entries without an envelope. The client documents no
order, so they are sorted stably by `createdAt`, oldest first. An empty session returns
`entries: []`. `vouchington agent-blackboard journal entries` still prints journal markdown only.

`sessionId` on `outbox_status`, `outbox_flush`, and `snapshot_export` only identifies the caller.
The outbox is per worktree and the status and flush cover every record in it. Flushing an empty
outbox does not create the directory. `snapshot_export` never accepts a destination: the
`agent-blackboard` client chooses a private file and returns its path. `session_archive` is the one
destructive tool; archived metadata is immutable, while entries stay appendable.

The outbox lives at `<worktree>/.local/blackboard-outbox` and is used only in interactive mode.
Autonomous mode forbids a filesystem outbox, so a failed delivery is an error.

## Worktree validation

`worktree` must be an absolute path that, after resolving symlinks, exactly matches an entry of
`git worktree list --porcelain` for the repository the server was launched from. The list is read on
every call, so worktrees created after launch are accepted and removed ones are refused. Anything
else is rejected: a subdirectory of a worktree, a relative or nonexistent path, and a separate
repository, including one made with `git init` elsewhere. It defaults to the launch worktree's root.
Git runs without `GIT_*` variables, so `GIT_DIR` cannot redirect the check.

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

## What is verified

Covered by this package's tests: the tool list and schemas, every tool's success and rejection
paths against a faked blackboard client, the worktree gate against real temporary git repositories,
an in-process client and server round trip through the SDK's in-memory transport, and a spawned
`vouchington mcp` process driven over real stdio.

Not verified, and tracked as the unchecked Phase 0 checklist in
[#324](https://github.com/vouchington/vouchington-tooling/issues/324): each harness's approval
syntax and whether the rules above take effect, the working directory after entering a worktree,
environment interpolation and credential passing, `gh` authentication, behavior in a freshly
created worktree, and connectivity from automation. Treat the registration snippets and permission
rules as untested per harness until that checklist is complete.
