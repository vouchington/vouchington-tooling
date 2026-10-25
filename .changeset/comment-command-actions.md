---
'vouchington-tooling': minor
---

Add the `comment-command-authorize` and `comment-command-acknowledge` composite actions for
comment-command workflows. `comment-command-authorize` checks the commenter's `author_association`
against `allowed-associations` (default `OWNER,COLLABORATOR,MEMBER`) and outputs `authorized` and
`association`; `mode: revalidate` refetches the comment by id and fails when it no longer
qualifies. `comment-command-acknowledge` adds an `eyes` reaction and, on the first run attempt,
posts a run-link comment, warning and continuing when either call fails.
