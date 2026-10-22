---
'vouchington-tooling': minor
---

Extend `vouchington-tooling/transient-retry` with run-context and log fetch: `buildWorkflowRunContext`
and `fetchWorkflowRunSummary` turn a GitHub Actions run into decision input (job state, bounded
head+tail failed-job logs streamed from `gh`, annotations, per-rule attempt replay), and
`rerunKnownTransient` plus the new `vouchington transient-retry --rules <module>` command rerun a
failed run when a rule from the caller's module matches. `RetryRule`, `RetryTarget` and `decide` are
now generic over the context type so rules can read the richer `WorkflowRunContext`. The engine has
no built-in rules; the log window, byte budgets, retry markers and token source are parameters.
