---
name: review-ci-logs
description: Audit CI failures or noisy logs, identify the root cause, and recommend diagnostics-preserving fixes.
---

# Review CI logs

Use when investigating a CI failure, repeated workflow noise, or misleading diagnostics. Read local
`AGENTS.md`, `CLAUDE.md`, workflow guidance, and CI documentation before inspecting runs.

1. Confirm the repository. Select representative failed and successful runs inside a bounded window.
   For a supplied run, inspect only that run.
2. Download logs to a temporary directory. Do not stream archives into the working context. Inspect
   failed steps and representative large entries, then remove the temporary artifacts.
3. Classify each finding as a real error, misleading output, a downstream cascade, a necessary
   diagnostic, or a volume-only concern. Identify the first repository-owned root cause.
4. For a persistent-workspace failure, name the producer of sparse state or unsafe ownership before
   proposing cleanup. Reject an unconditional pre-checkout workspace traversal. A compliant repair
   is the one in [github-actions-checklist](../github-actions-checklist/SKILL.md).
5. Prefer one bounded fix that preserves non-zero exits, primary errors, artifacts, summaries, and
   diagnostic evidence. Do not hide stderr, globally quiet output, or add a retry that masks the
   cause.
6. Add focused regression evidence, run local workflow validation, and compare before and after
   output where that comparison is meaningful. Report deferred findings. Do not create issues unless
   authorized.

Consumer wrapper owns: workflow names, log retention, the CI provider command, retry policy, and
scheduled automation.
