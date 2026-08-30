---
name: github-actions-checklist
description: Use when editing GitHub Actions workflows or composite actions to keep security, runner, permissions, concurrency, and validation aligned with local policy.
---

# GitHub Actions checklist

Use before editing a workflow or composite action. Repository-local instructions own runners,
approved action pinning, concurrency naming, secrets, permissions, and workflow-only PR rules.

Apply this portable baseline unless a stricter repository-local rule overrides it:

- Use `pull_request` for pull-request workflows in private repositories. Reserve
  `pull_request_target` for base-owned orchestration in public repositories or narrowly scoped
  Dependabot/Renovate automation. A privileged workflow must never check out or execute untrusted
  pull-request content.
- Load [github-actions-authoring](../github-actions-authoring/SKILL.md) when changing orchestration.
  Do not poll remote workflow, deployment, lease, service, or health state.
- Required checks must be actual workflow jobs that execute or aggregate the work they report.
  Workflow code must not create or publish check runs or commit statuses merely to synthesize a
  required context, copy another workflow's conclusion, or bypass the event graph. A purpose-built
  external CI or analysis integration may report its own result; do not use its API as a relay for
  work owned by GitHub Actions.
- On `main`, or the consumer's configured default branch, split test jobs by domain such as web and
  backend instead of hiding unrelated suites in one monolithic test job. Keep domain job names stable
  when they are required checks, and use a real bounded fan-in job only when the merge contract needs
  one combined result.
- For pull requests, configure test concurrency with `cancel-in-progress: true` so a superseded head
  does not consume runner capacity. On `main`, or the consumer's configured default branch, test runs must never use `cancel-in-progress: true`;
  every pushed revision must reach a terminal result. Require distinct concurrency groups or an explicit
  queueing mechanism for `main` runs rather than relying only on `cancel-in-progress: false`. When one
  workflow handles both events, keep cancellation enabled only for pull-request groups, using
  `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` or an equivalent exact event predicate.
- Give every concrete job a timeout of no more than 30 minutes. A caller job that invokes a reusable
  workflow through top-level `jobs.<job_id>.uses` cannot accept `timeout-minutes`; enforce the bound
  on every concrete job inside the called workflow. If the underlying operation cannot terminate
  inside that bound, decompose it into event-driven phases; lowering or moving the timeout alone does
  not fix the design. Preserve a required job or check name with a bounded fan-in job when splitting
  work would otherwise change the repository's merge contract. Each underlying phase must also have
  a deadline of no more than 30 minutes and support cancellation, rollback, or an explicit terminal
  retained/recovery state. An event callback may report completion; it must not hide a longer-running
  operation in another service.
- Use GitHub-hosted runners only for public repositories. Private repositories use the consumer's
  approved self-hosted or disposable runner labels.
- Pin every repository-backed external `uses:` reference—anything other than a local `./...`
  action—to a full lowercase 40-character Git SHA followed immediately by its machine-maintainable
  version comment, such as `# v4.2.0`, so Dependabot can update both. Pin `docker://...` actions to an
  immutable `@sha256:` image digest instead of a Git SHA. Keep GitHub Actions dependency updates
  enabled.
- Workflow tests and fixtures must not assert an action dependency's exact SHA or version. Assert
  the action identity and Git SHA shape, or derive the dependency ref from the workflow under test,
  so dependency-update pull requests can change pins without synchronized fixture edits. This does
  not prohibit asserting an exact source revision in `with.ref` when exact-head checkout is a
  workflow security invariant.

1. Read every applicable `AGENTS.md` and `CLAUDE.md` from the repository root through the workflow,
   plus relevant CI documentation and callers. Apply the closest instruction only when rules
   conflict. Identify trusted and untrusted inputs and every credential boundary.
2. Give each job the least permissions it needs. Keep untrusted pull-request content out of shell
   interpolation, privileged tokens, and write-capable steps.
3. Apply the portable check, test-topology, concurrency, pinning, runner, trigger, and timeout
   baseline plus any stricter consumer policy. Keep checkout refs, artifact boundaries, caches, and
   concurrency behavior explicit.
4. Validate changed YAML with the local workflow checker and run the affected workflow tests or
   scripts. Update local CI documentation when behavior or operator expectations change.
5. Review the final diff for privilege escalation, accidental secret exposure, unsafe quoting,
   unsupported runner assumptions, and unreachable workflow paths.

This skill intentionally has no default runner labels, action SHAs, workflow directories,
concurrency scheme, or release policy. A consumer wrapper supplies those values.
