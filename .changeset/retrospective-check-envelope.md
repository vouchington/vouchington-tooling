---
'vouchington-tooling': patch
---

`retrospective_check` now validates schema-versioned retrospective entries with the feedback
envelope validator, so a malformed versioned entry no longer reports `saved: true`. Unversioned
legacy entries are still accepted.
