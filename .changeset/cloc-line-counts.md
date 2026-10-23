---
'vouchington-tooling': minor
---

Add `vouchington cloc --config <file>` and the `vouchington-tooling/cloc` subpath. It counts git-tracked lines with `scc` and prints a table by category (source, tests, tooling) and service. The service rules, category patterns, counted roots and files, excluded and ignored directories, `scc` binary (`--scc-bin`, `SCC_BIN` or config) and the missing-binary hint all come from a JSON or module layout config, so no repository layout lives in the package.
