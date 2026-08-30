---
name: review-ci-logs
description: Audit CI failures or noisy logs, identify the root cause, and recommend diagnostics-preserving fixes.
---

# Review CI logs

Use when investigating CI failures, repeated workflow noise, or misleading diagnostics. Read local
`AGENTS.md`, `CLAUDE.md`, workflow guidance, and CI documentation before inspecting runs.

1. Confirm the repository and select representative failed and successful runs within a bounded
   window. For a supplied run, inspect only that run.
2. Download logs to a temporary directory instead of streaming archives into the working context.
   Inspect failed steps and representative large entries, then remove temporary artifacts.
3. Classify findings as a real error, misleading output, downstream cascade, necessary diagnostic,
   or volume-only concern. Identify the first repository-owned root cause.
4. Prefer one bounded fix that preserves non-zero exits, primary errors, artifacts, summaries, and
   diagnostic evidence. Do not hide stderr, globally quiet output, or add retries to mask a cause.
5. Add focused regression evidence, run local workflow validation, compare before and after output
   where meaningful, and report deferred findings without creating issues unless authorized.

This skill supplies no workflow names, log-retention policy, CI provider command, retry policy, or
scheduled automation. Consumer wrappers provide those local details.
