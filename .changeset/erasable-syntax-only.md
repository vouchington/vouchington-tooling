---
'vouchington-tooling': patch
---

Fix `gh-cli` barrel import under Node type stripping by replacing constructor parameter properties with explicit fields, and enable `erasableSyntaxOnly` so non-erasable syntax fails typecheck.
