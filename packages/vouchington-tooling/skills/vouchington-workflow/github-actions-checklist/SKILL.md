---
name: github-actions-checklist
description: Use when editing GitHub Actions workflows or composite actions to keep security, runner, permissions, concurrency, and validation aligned with local policy.
---

# GitHub Actions checklist

Use before editing a workflow or composite action. Repository-local instructions own runners,
approved action pinning, concurrency naming, secrets, permissions, and workflow-only PR rules.

1. Read every applicable `AGENTS.md` and `CLAUDE.md` from the repository root through the workflow,
   plus relevant CI documentation and callers. Apply the closest instruction only when rules
   conflict. Identify trusted and untrusted inputs and every credential boundary.
2. Give each job the least permissions it needs. Keep untrusted pull-request content out of shell
   interpolation, privileged tokens, and write-capable steps.
3. Use the repository's pinned-action and runner policy. Keep checkout refs, artifact boundaries,
   caches, and concurrency behavior explicit.
4. Validate changed YAML with the local workflow checker and run the affected workflow tests or
   scripts. Update local CI documentation when behavior or operator expectations change.
5. Review the final diff for privilege escalation, accidental secret exposure, unsafe quoting,
   unsupported runner assumptions, and unreachable workflow paths.

This skill intentionally has no default runner labels, action SHAs, workflow directories,
concurrency scheme, or release policy. A consumer wrapper supplies those values.
