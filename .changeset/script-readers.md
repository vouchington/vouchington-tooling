---
'vouchington-tooling': minor
---

`trivy-policy` no longer rejects Trivy package scans that live in tracked shell scripts. Those scans
are now collected with the ones in workflow run blocks and must meet the same vulnerability gate and
SBOM rules; unsupported Trivy actions are still rejected. `assertNoUnsupportedTrivyShellSource` is
removed.

The config inventory now also recognizes shell parameter references such as `"$NAME/suffix"` and
`${NAME}` in scripts, so a workflow step env var consumed only by a script is no longer reported as
unused. A longer name such as `$NAMEX` still does not count as `NAME`.
