---
'vouchington-tooling': minor
---

Add `vouchington-tooling/coverage-scope` and `vouchington coverage-scope-check`. The command fails
when a tracked file under a positive-threshold `.coverage-rules.yml` rule is not instrumented by the
collector. The collector scope comes from repeated `--include`/`--exclude` globs or a `--scope-file`
JSON file; the rules file defaults to `.coverage-rules.yml` and can be set with `--rules`.
