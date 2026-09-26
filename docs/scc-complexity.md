# scc complexity ceiling

`pnpm run lint` runs `scc` 3.7.0 once and fails when a counted tracked file's complexity is over 50. That is the same ceiling and the same `scc` release as the Vouchington product repository.
Scores differ between `scc` releases, so [`.mise.toml`](../.mise.toml) pins `github:boyter/scc` to
3.7.0 and the lint script runs it through `mise exec`.

The scan is `scc --format json --by-file` for `js`, `mts`, `jsx`, `ts`, and `tsx`. It skips
`.git`, `fixtures`, `__tests__`, and `test-helpers` directories, and it skips paths matching
`\.(test|spec)\.`. Only tracked files can fail the gate.

Files at or under 50 need no entry. Files still over 50 are listed in
[`scc-complexity-baseline.json`](../scc-complexity-baseline.json) with the complexity they have
now. A listed file may fall, and it fails if it rises above its ceiling. When a listed file
reaches 50 or below, delete its entry in the same change. A file that is not listed fails above
50 with `simplify or split this file`.

CI installs the pinned `scc` with `jdx/mise-action` before lint. The job cache stays off.
