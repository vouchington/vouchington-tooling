---
'vouchington-tooling': patch
---

`ast-grep-examples` now writes each path-scoped rule without its `examples` key before scanning, so
ast-grep 0.51.1, which rejects unknown rule keys, accepts it. The rule's `files` and `ignores`
still apply.
