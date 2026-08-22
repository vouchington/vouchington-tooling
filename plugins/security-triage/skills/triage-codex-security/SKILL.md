---
name: triage-codex-security
description: Triage Codex Security findings for one repository into evidence-backed, explicitly approved outcomes. Use when clearing or reviewing a Codex Security finding queue; leave repository issue management to the consumer.
---

# Codex Security triage

Use this skill only for one repository per run. It produces finding results and the
[`codex-security-triage/v1`](references/handoff-v1.md) handoff; it does not create
repository issues, apply labels or milestones, or shepherd pull requests.

## Establish the evidence boundary

1. Select `origin` when it exists. Otherwise, select the only remote; if there are zero or more
   than one remotes, stop and ask the user which remote is authoritative.
2. Normalize the selected remote. For GitHub SSH or HTTPS remotes, use lowercase
   `github.com/owner/repo` without `.git`. For other hosts, lowercase the host, remove a leading
   slash and trailing `.git` from the path, and preserve the normalized path's case and segments.
3. Resolve the selected remote's default branch, fetch it, and record `selectedRemote`,
   `canonicalRepository`, `defaultBranch`, and the fetched immutable `evidenceSha`. A dirty
   checkout is useful only when the user explicitly selects it for analysis; it cannot prove a
   hosted action.
4. Require the hosted finding/repository selector to prove the same `canonicalRepository` before
   any hosted action. Block on mismatch or ambiguity; never infer a repository from a finding.
5. If input names more than one repository, partition it and stop until each partition has a
   matching checkout. Never carry a finding or evidence SHA across repositories.

## Intake and analysis

Prefer the official Codex Security plugin. When it is unavailable, use the trusted official
`@openai/codex-security` CLI only for commands its installed version advertises, such as saved
local findings, exports, and validation. Do not add a CLI, install software, or use a
repository-local shadow executable automatically.

For hosted findings, use a native authenticated browser only when one is available. Enumerate the
queue read-only before proposing changes. If no browser is available, accept a user-provided export
for analysis but block hosted writes. Do not use browser-automation frameworks.

Create one result for every finding before grouping it:

- `confirmed`: group a repository issue candidate, or use the provider's approved fix flow.
- `needs_review`: group an investigation candidate; never close it.
- `not_actionable`: record the exact supported reason and the evidence for closing it.
- `overstated`: record why the finding is valid but its severity should be lowered.

Trace the actual source, sink, boundary, and reachable controls. State the evidence paths and why
they apply to the immutable `evidenceSha`; uncertainty is `needs_review`, not a close.

## Approval and hosted changes

Present an explicit list of findings and the proposed action before every hosted write. Each
approval wave contains at most 25 findings. Stop and wait for an affirmative response approving
the exact finding IDs and actions in the current wave before any Close, severity, or provider-PR
write. Approval is session-bound: restart, lost context, repository mismatch, changed state, or
an ambiguous approval requires fresh enumeration and a new approval.

Immediately re-read each finding before and after a write. Never retry a hosted write blindly.
For a provider fix, use the provider UI to create the PR, then verify and return its number, URL,
and provenance in the handoff. The consuming repository decides whether to shepherd that PR.

## Public boundary

Keep this plugin provider-neutral and public: do not copy official prompts, include credentials,
or commit real findings, private paths, queue counts, or exports. Use synthetic fixtures for
contract validation.
