---
'vouchington-tooling': patch
---

`vouchington tmux agent-reminder` and `post-tool` now read hook payloads through the shared
command-policy reader, so Cursor's `Shell`/`tool_output` shape is normalized and a failed Cursor
command no longer triggers a reminder. Payload fields only the old tmux reader accepted (`name`,
`input`) are no longer read.
