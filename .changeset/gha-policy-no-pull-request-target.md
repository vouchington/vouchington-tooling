---
'vouchington-tooling': minor
---

`gha-workspace-policy` now rejects workflows triggered by `pull_request_target`, whatever form
their `on:` key takes. Repositories still using it must move those workflows to `pull_request`
before upgrading.
