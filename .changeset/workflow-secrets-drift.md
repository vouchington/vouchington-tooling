---
'vouchington-tooling': minor
---

Add `vouchington verify-workflow-secrets` and the `vouchington-tooling/workflow-secrets-drift`
subpath: compare a checked-in secret inventory module against the live repository, organization
and environment secret names (names and presence only, never values) and report drift, scope
violations and deployment-branch policy gaps. The repository, inventory module path and export
name, the required deployment branch, and the `gh` runner are all parameters.
