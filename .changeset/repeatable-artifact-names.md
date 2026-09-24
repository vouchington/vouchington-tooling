---
'vouchington-tooling': minor
---

Let `download-optional-run-artifacts` take repeated `--name <artifact>` flags (mutually exclusive
with `--pattern`). The run's artifacts are listed once and each requested name that is present is
extracted into `<dir>/<name>`. Absent names produce one bounded warning, a present artifact whose
download fails is a hard failure naming that artifact, and `availability=unavailable` is written only
when none of the requested names exist. A single `--name` now extracts into `<dir>/<name>` like every
other name instead of directly into `<dir>`.
