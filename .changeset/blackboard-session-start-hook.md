---
'vouchington-tooling': minor
---

Add `vouchington agent-blackboard session-start`, a SessionStart hook that prints the hook payload's
own session id (`session_id`, `sessionId`, or `conversation_id`) as a `Blackboard sessionId:` line
for the journal tools and adds an advisory probe of the hosted deployment. The probe is skipped on
compact restarts, when the `--skip-env` variable (default `CHECK_BLACKBOARD_SKIP`) is `1`, and inside
the Claude Code sandbox (where it would report a false outage); a missing `agent-blackboard` client
is reported as a workspace-setup problem rather than an outage. It never fails the session.
`--setup-hint` and `--docs-path` carry repository-specific remediation text. The library behind it
(`payloadSessionId`, `probeAdvisory`, `sessionStartContext`, `sessionStartOutput`) is exported from
`vouchington-tooling/agent-blackboard`. A missing upstream client now throws
`BlackboardNotInstalledError`, an `Error` subclass with the same message as before.
