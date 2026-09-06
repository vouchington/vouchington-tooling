# Agent harness config

`vouchington agent-harness-config` merges a portable **classifier-auto + sandbox**
policy into Claude, Codex, Grok, and Cursor config files. It does not copy
allowlists, hooks, plugins, MCP servers, or models.

Use it to keep local interactive sessions on a permission classifier (routine
work proceeds, risky calls still prompt) with an OS sandbox enabled.

## Classifier vs always-approve

Always-approve / YOLO is not the same as classifier auto. Cursor
`unrestricted` also forces the sandbox off.

| Harness | Classifier (this tool writes)                                             | Do not use                                        | Sandbox                                                            |
| ------- | ------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| Claude  | `permissions.defaultMode = "auto"`                                        | `bypassPermissions`                               | `sandbox.enabled = true`, fail closed if unavailable               |
| Codex   | `approval_policy = "on-request"` and `approvals_reviewer = "auto_review"` | `approval_policy = "never"`                       | `sandbox_mode = "workspace-write"` plus extra writable roots       |
| Grok    | `ui.permission_mode = "auto"`                                             | `always-approve` / `bypassPermissions` / `--yolo` | defines `workspace-write`; invoke with `--sandbox workspace-write` |
| Cursor  | `approvalMode = "auto-review"`                                            | `unrestricted` (`--force` / `--yolo`)             | `sandbox.mode = "enabled"`                                         |

Grok Auto is a separate mode from plan. Shift+Tab is `Normal → Plan → Auto
(when enabled) → Always-approve`. The tool also writes `auto_mode.enabled =
true` and `default_auto_mode = true` so Auto is available by default and
stays the permission classifier under plan mode. Plan-file edits remain
auto-approved; other file edits stay blocked. That is not YOLO.

Repo Claude settings set `sandbox.enabled` and `sandbox.failIfUnavailable`.
They do not change a
project `permissions.defaultMode` of `"plan"`.

Grok config can define a sandbox profile but cannot activate it for a future
session. Start Grok with `--sandbox workspace-write`; `check` reports this as
an unmet manual prerequisite so it never claims the profile is active.

## CLI

```bash
vouchington agent-harness-config dump
vouchington agent-harness-config check --global
vouchington agent-harness-config check --repo /path/to/checkout
vouchington agent-harness-config apply --global --repo /path --repo /other
vouchington agent-harness-config apply --global --harness grok --harness cursor
```

- `dump` prints the canonical key map as JSON. It does not need `--global` or `--repo`.
- `check` and `apply` require at least one of `--global` or `--repo` (repeatable).
- `--harness` filters to `claude`, `codex`, `grok`, or `cursor`. Default is all four.
- `--home` overrides the user home directory (tests and nonstandard layouts).
- `check` exits `0` when every targeted file and prerequisite matches, `1` on drift or an unmet prerequisite, and `2` on usage errors.
- `apply` writes only drifted keys, then exits `1` when a prerequisite remains unmet and `2` on I/O or usage errors.

## Library

```ts
import {
  applyHarnessConfig,
  checkHarnessConfig,
  dumpHarnessPolicy,
  planHarnessConfig,
} from 'vouchington-tooling/agent-harness-config'

const dump = dumpHarnessPolicy()
await checkHarnessConfig({ kind: 'global' }, { home: '/tmp/isolated-home' })
await applyHarnessConfig({ kind: 'repo', root: '/path/to/checkout' }, { harnesses: ['grok'] })
```

Pass `home` in options so tests never touch the real `~/.claude` or `~/.cursor`.
`extraWritableRoots` replaces the shipped toolchain cache list.

## Files

Global (`--global`, under `$HOME` or `--home`):

| File                      | Keys                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `.claude/settings.json`   | `permissions.defaultMode`, `sandbox.enabled`, `sandbox.failIfUnavailable`, `useAutoModeDuringPlan` |
| `.codex/config.toml`      | `approval_policy`, `approvals_reviewer`, `sandbox_mode`, `[sandbox_workspace_write]`               |
| `.grok/sandbox.toml`      | `[profiles.workspace-write]` extra roots (written first)                                           |
| `.grok/config.toml`       | `ui.permission_mode`, `auto_mode.enabled`, `default_auto_mode`                                     |
| `.cursor/cli-config.json` | `approvalMode`, `sandbox.mode`                                                                     |

The Grok profile is selected per invocation with `--sandbox workspace-write`.

Repo (`--repo`):

| File                    | Keys                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| `.claude/settings.json` | `sandbox.enabled`, `sandbox.failIfUnavailable`, `sandbox.filesystem.allowWrite` |
| `.codex/config.toml`    | same Codex keys as global                                                       |
| `.grok/sandbox.toml`    | extra roots only (project config cannot set the default profile)                |
| `.cursor/sandbox.json`  | `workspace_readwrite` extra roots and `networkPolicy.default = allow`           |

Repo-local classifier settings have user-level prerequisites:

- Codex loads `.codex/config.toml` only after the absolute checkout path has
  `trust_level = "trusted"` in `~/.codex/config.toml`. This command checks that
  entry but never creates or changes it.
- Cursor approval mode belongs in `~/.cursor/cli-config.json`; the repo command
  checks for global `auto-review` and intentionally leaves `.cursor/cli.json`
  untouched.
- Grok sandbox activation is per invocation as described above.

These scope boundaries follow the current vendor references for
[Claude sandboxing](https://code.claude.com/docs/en/sandboxing),
[Codex project config](https://developers.openai.com/codex/config-reference),
[Grok settings](https://docs.x.ai/build/settings),
[Grok permissions](https://docs.x.ai/build/features/permissions),
[Cursor CLI config](https://prod.cursor.com/docs/cli/reference/configuration), and
[Cursor repo sandbox config](https://prod.cursor.com/docs/reference/sandbox).

Missing files are created with only these keys. Sibling keys are preserved.
JSON is pretty-printed with a trailing newline. TOML upserts named keys
without rewriting unrelated tables such as `[[marketplace.sources]]` or
`[projects."…"]`.

## Extra writable roots

The default list is toolchain caches, not product paths:

- `~/.cargo`
- `~/Library/pnpm`, `~/.local/share/pnpm`, `~/.pnpm-store`
- `~/Library/Caches/pnpm`, `~/.cache/pnpm`
- `~/.pnpm-state`, `~/.local/state/pnpm`
- `~/Library/Caches/no-mistakes`, `~/.cache/no-mistakes`
- `/var/folders`, `/private/var/folders`

Replace the list through `extraWritableRoots` when a checkout needs different roots.

## Out of scope

The tool does not copy permission allow/deny lists, `sandbox.excludedCommands`,
hooks, plugins, MCP servers, or model settings. Those stay in each checkout
or user config.
