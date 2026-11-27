---
'vouchington-tooling': minor
---

`NoSourceLinePairTemplate` in `vouchington-tooling/pr-description` accepts `requiredBodyLinePatterns`, a list of RegExps that must each match a whole sanitized body line. `hasRelatedIssuesNoSourcePair` is satisfied by a line in `requiredBodyLines` or a line matching any pattern, so a policy can accept `Workspace setup: <name> scheduled prompt` instead of one exact string. Patterns with the `g` or `y` flag throw a `TypeError`. Exact `requiredBodyLines` behave as before.
