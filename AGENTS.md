# Development

pnpm workspace. Node >= 24. Two published packages live under `packages/`.

pnpm 12 is required but never pinned: no `packageManager` or `devEngines.packageManager` field,
no Corepack, and every `pnpm/action-setup` step takes only `version: latest-12` after
`actions/setup-node`. CI therefore runs the newest pnpm 12 release that is at least one day old: 12.x
releases reach CI without a PR, and moving to pnpm 13 needs one.
`packages/vouchington-tooling/src/pnpm-setup-policy.test.mts` enforces this.

## Commands

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
pnpm run test:coverage
```

`oxlint` is type-aware and denies warnings. Source files are capped at 200 lines; tests at 500.

## Packages

- `vouchington-tooling` — CLI (`vouchington`) and subpath libraries
- `eslint-plugin-vouchington` — non-generic Vouchington lint rules

Generic ESLint/Oxlint rules belong in `jonathanong/no-mistakes`, not this repo. This workspace is too small for `no-mistakes` test planning; keep generic rules upstream.

Use `pr-shepherd` (not `gh pr checks`) to iterate pull requests.

## Agent Blackboard

Journal through this repository's own `vouchington mcp` server, registered as `vouchington-tooling`
in `.mcp.json` and `.codex/config.toml` and run from `packages/vouchington-tooling/src`, and follow
`vouchington-workflow:blackboard` for the tools and journaling policy. The upstream
`agent-blackboard` plugin is disabled here. Choose an explicit root session id and ensure it before
recording work, preserve exact parent/child session identities, and append contemporaneous notes
for failed checks, denied permissions, scope changes, repeated fixes, and reusable tool gaps. Tag
every entry's `repositories` with only the sorted, deduplicated lowercase `owner/name` values
relevant to it; `journal_append` merges them into the session's repository union. Each agent writes
only its own session. Start a new session for work after archival.

The hosted connection requires `AGENT_BLACKBOARD_URL` and `AGENT_BLACKBOARD_TOKEN`. Never search
for, print, or mint credentials. Select the trusted runner mode explicitly: interactive work may
continue after the shared writer persists sanitized feedback in its bounded private outbox, with
the `pendingCount` (this session) and `worktreePendingCount` (every session) from `outbox_status`
and delivery through `outbox_flush`. Failed persistence or
identity/content conflicts block capture. Autonomous work requires fresh online append/readback
before admission and acknowledged terminal reporting; missing or rejected credentials block it.
Never substitute an ad hoc local journal file or use an outbox to authorize autonomous work.
Opening a harness session here starts the server from the checked-out source with the blackboard
credentials, so review untrusted branches without a session or with the credentials unset.

## Extracted modules

Extracted code must contain no product identifiers. Repo-specific values are parameters, flags, or env vars (`HOST_LOCK_*`, not product-prefixed names).

Record the source SHA and path list in the commit body when copying from the product monorepo.

## Publishing

Do not publish from a laptop. The `Release` workflow is `workflow_dispatch` and publishes with npm trusted publishing (OIDC). `RELEASE_TOKEN` needs Contents Read & Write on this repository for the version-bump push and GitHub release. There is no `NPM_TOKEN` on purpose.
