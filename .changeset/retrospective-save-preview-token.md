---
'vouchington-tooling': minor
---

`retrospective_save` dry runs now return a single-use `previewToken`, bound to the session, worktree,
event id and exact redacted content and held only in server memory. Passing it to a second
`retrospective_save` call saves exactly the previewed content, so sensitive values no longer need to
be repeated and cannot conflict or leak. Markdown saves also accept `knownSensitiveValues`, which
redacts the markdown, `category` and `feedbackCoverage`.
