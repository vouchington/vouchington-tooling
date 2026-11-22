---
'vouchington-tooling': minor
---

Add `checkAstGrepIgnoresFreshness` (plus `staleAstGrepIgnores` and `astGrepIgnoreEntries`) to `vouchington-tooling/ast-grep-config-parity`: it reports `ignores:` entries in tracked rule YAML under `localRuleDir` that name no tracked file and match no tracked glob. Add the `vouchington-tooling/fixture-deadline` subpath exporting `createFixtureDeadline(timeoutMs = 4000)`, which replaces the internal dead-code test helper.
