---
'vouchington-tooling': patch
---

The command policy now denies quoted and mixed-case git config overrides such as
`git -c "core.hooksPath=/dev/null" status` and `git -c 'CORE.hookspath=x' status`. `PatternRule`
gains a `configKey` form that reads `git -c` and `--config-env` through `gitInvocations`, so
quoting and key case cannot bypass it, while `git commit -m "core.hooksPath=x"` stays allowed.
