---
'vouchington-tooling': patch
---

Spawn `gh` with `CLICOLOR_FORCE` removed from its environment so `--json` output is never
ANSI-colored, which previously broke `JSON.parse` for `runGh` and the other `gh` call sites when an
agent shell exported `CLICOLOR_FORCE=1`. Every other variable passes through. Adds `ghSpawnEnv` to
the `gh-cli` exports.
