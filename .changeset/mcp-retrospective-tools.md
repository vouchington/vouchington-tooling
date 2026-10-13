---
'vouchington-tooling': minor
---

Add the `retrospective_check` and `retrospective_save` MCP tools. `retrospective_save` composes or
accepts a retrospective, checks its front matter against the arguments, and runs the consumer's
`validateRetrospective` policy export (declared in `package.json` under `vouchington-tooling.policy`)
in a child process without blackboard credentials before writing through the verified path. The
server now only accepts worktrees of the repository it was launched in.
