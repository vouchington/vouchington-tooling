---
'vouchington-tooling': minor
---

`vouchington-tooling/agent-harness-identity` is now a thin adapter over agent-blackboard 0.7.0's
harness table: `HARNESS_IDS`, `selectHarnessSession`, and the `HarnessId`, `HarnessEnvironment`
and `HarnessSessionIdentity` types are re-exported, and `inspectHarnessEnvironment` keeps its
`env = process.env` default. The duplicated table is removed, and `deriveAgent` takes its harness
precedence from agent-blackboard's `HARNESS_SESSION_PRECEDENCE`. Behavior is unchanged.
`agent-blackboard` is bumped to `^0.7.0` (dev and peer). It remains an optional peer, but
`agent-harness-identity`, and therefore the package root, now import it, so it must be installed to load them.
