---
'vouchington-tooling': patch
---

Report `download-optional-run-artifacts` `--name` candidates absent from the run as a single bounded
`::notice::` instead of a `::warning::`. Absent exact-name candidates are expected in name mode
(callers pass a superset such as retry-attempt variants that usually do not exist), so a warning
annotation fired on every green run. `--pattern` behavior and its warnings are unchanged, and a
present artifact whose download fails remains a hard failure.
