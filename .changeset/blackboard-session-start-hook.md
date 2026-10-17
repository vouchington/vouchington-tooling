---
'vouchington-tooling': minor
---

Add `vouchington agent-blackboard session-start`, a SessionStart hook that prints the hook payload's
own session id (`session_id`, `sessionId`, or `conversation_id`) as a `Blackboard sessionId:` line
for the journal tools and adds an advisory probe of the hosted deployment. The probe is skipped on
compact restarts, when the `--skip-env` variable (default `CHECK_BLACKBOARD_SKIP`) is `1`, and inside
a sandbox (where it would report a false outage; the advisory says not to rerun unsandboxed and
points at restoring the journal server, with `--restore-hint` for repository-specific steps). The
probe has a `--timeout-ms` deadline (default 5000); on expiry it emits the advisory and the command
forces exit so a hung request cannot keep the process alive; a missing `agent-blackboard` client
is reported as a workspace-setup problem rather than an outage. It never fails the session.
`--setup-hint` and `--docs-path` carry repository-specific remediation text. The library behind it
(`payloadSessionId`, `probeAdvisory`, `sessionStartContext`, `sessionStartOutput`) is exported from
`vouchington-tooling/agent-blackboard`. A missing upstream client now throws
`BlackboardNotInstalledError` (also exported from the barrel), an `Error` subclass with the same message as before.
