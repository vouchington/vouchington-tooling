# Agent configuration ownership

Machine-wide Claude, Codex, Grok, and Cursor settings belong to
[vouchington-machines](https://github.com/vouchington/vouchington-machines/blob/main/docs/agent-config.md).
Run its `./configure-agents.sh --dry-run` before `./configure-agents.sh` to update local
configuration, and `./diagnose-agents.sh` to diagnose sandbox or configuration problems.

The `agent-harness-config` CLI command and library export have been retired.
Project checkouts retain project hooks, permissions, and shared instructions; MCP registration
(the `vouchington-tooling` server) and the upstream `agent-blackboard` plugin disable are
machine-owned and must not be recreated per repository. Checkouts do not enforce machine sandbox, approval, model, or UI preferences.
