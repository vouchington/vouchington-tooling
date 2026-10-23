---
'vouchington-tooling': minor
---

Add `ciReporters`, `ciOutputFile`, `normalizeGithubActionsPath`, and the file and Storybook progress
reporters to `vouchington-tooling/vitest-diagnostics`. Env var names, progress marker prefixes, and
extra reporters are parameters, and `latestStorybookProgressSequence` builds its pattern from the
prefix.
