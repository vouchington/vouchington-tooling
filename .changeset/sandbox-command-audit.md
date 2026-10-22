---
'vouchington-tooling': minor
---

Add `vouchington sandbox-command-audit --rules <module>` and the `vouchington-tooling/sandbox-command-audit` subpath. The audit scans Claude and Codex transcripts, scoped to the repository (its checkout, its linked worktrees, and optional `--worktree-glob` layouts), for Bash calls that escalated out of the sandbox, were denied, or failed on a permission signature, and groups them by command prefix. The transcript roots, settings location, scan limits and worktree layouts are parameters. The repository's own rules are injected through the module (`loadPolicy`, and optional `classifyFailure`, `limits` and `worktreeGlobs`), so no classification lives in the package.
