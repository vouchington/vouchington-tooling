---
'vouchington-tooling': minor
---

Add `gitInvocations(command)` and `overridesConfig(invocation, key)` to `vouchington-tooling/shell-parse`. `gitInvocations` returns each `git` in command position (after separators, env assignments, and wrappers such as `env`, `sudo`, `xargs`, `timeout`, `nice`) as `{ globalOptions, configOverrides, subcommand, args }`, skipping global options such as `-c`, `-C`, and `--git-dir`. `overridesConfig` checks a `-c` key case-insensitively.
