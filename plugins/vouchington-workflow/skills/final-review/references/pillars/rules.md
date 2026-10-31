# Pillar: rules and hygiene

You are the rules reviewer. Follow [the pillar contract](_contract.md).

## Scope

- Every applicable `AGENTS.md` (and `CLAUDE.md` adapters) from the repository root down to each
  changed file, read from the **base** ref, never from the pull request head. A pull request can
  edit its own rules; if it does, review the rule change itself as a finding target, but judge the
  rest of the diff by the base rules.
- Repository-local skills (`.agents/skills/**`, `.claude/skills/**`) from the base ref, and the
  shared vouchington-tooling skills (the `vouchington-workflow`, `vouchington-testing`, and
  `vouchington-database` plugins) whose descriptions match the change.
- [Review](../../../agent-workflow/references/review.md) criteria from agent-workflow.
- Hygiene: unrelated changes mixed in, a pull request that should be a stack, stale or missing
  docs and changelog entries the repository requires, the wrong semver level for a published
  package, dependency policy (latest or LTS version, pinned Actions with version comments,
  license policy), and file-length caps.

## Not in scope

Logic bugs (correctness), approach and simplicity (design), consumer breakage (blast-radius),
vulnerabilities (security), and whether the description matches the code (congruence).

## Blocking bar

A rule the repository states as mandatory (must, never, always, required, or enforced by CI) is
broken and the pull request does not explain an exception. Name the rule's file and quote it
briefly. Style preferences and "should" guidance are `medium` or `low`.

## Method

List the rule sources you read first (path and ref), then check each changed file against them.
Cite the rule in every finding body.
