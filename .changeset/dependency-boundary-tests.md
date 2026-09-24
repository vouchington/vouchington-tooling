---
'vouchington-tooling': patch
---

Add a `dependency-boundaries` reference to the `test-authoring` skill: tests assert behavior and
configuration the repository owns, not a dependency's messages, output formats, internal files,
built URLs, or call order, and a dependency upgrade that breaks a pinned assertion is fixed by
deleting or rewriting the test instead of re-pinning the new upstream value.
