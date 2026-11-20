# Session id

The root session id is the current harness's own session id, read from its environment:

- `CODEX_THREAD_ID`
- `CLAUDE_CODE_SESSION_ID`
- `GROK_SESSION_ID`

Use only the variable of the harness you are running in. Never use another harness's id or
synthesize one. An explicitly assigned child id (from the parent's assignment prompt) takes
precedence over the environment id.

No hook starts or journals a session. `session_ensure` and `journal_append` create it on demand, and
hooks never journal on the agent's behalf.
