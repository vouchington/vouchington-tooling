---
name: pr-description
description: Write a self-contained PR description backed by the final diff.
---

# Pull-request description

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/pr-description/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Use before opening or updating a pull request, after diagnosing a CI failure, or at handoff. Read local
`AGENTS.md`, pull-request template, and issue-linking policy first.

Write for a reviewer who has not seen the conversation or the code. Use plain language and short
bullets, not dense paragraphs of internal terms. Its visible core explains:

- **Summary:** open with one or two sentences on the outcome in plain terms. Then give a
  **Why:** that names the concrete problem or risk, such as who could do what before this change.
  For a fix, give the root cause as well as the symptom.
- **Before/after table:** for any behavior change, add a visible table whose rows are concrete
  scenarios, such as requests, configurations, environments, inputs, or user actions. Its columns
  are the situation, the behavior before, and the behavior after. Include the unchanged cases a
  reviewer would worry about, and the error or status each failure case returns.
- **Diagram:** when a request or event crosses components, add a Mermaid `sequenceDiagram` of the
  new flow. Use a `flowchart` for decision logic or changed architecture. Keep the main diagram
  visible.
- **Impact:** one bullet per affected audience, such as end users, staff, native or API clients,
  operators, or contributors, saying what each one sees. Say when the change is active: what
  enables it, such as a plan tier, feature flag, environment, configuration value, or rollout
  step, and whether current deployments already satisfy it. Name the configuration it reads and
  its defaults. Keep risks, limitations, and dependent follow-ups visible.

Put implementation detail under **Details**, grouped by subsystem with short headings. Name the
files and functions that carry each part, so a reviewer can find them. Leave CI history, rebase
narrative, and local test lists out of the body; the Shepherd Journal and evidence record hold
them.

Add detail only where the change warrants it:

- For cost changes, state the direction and scope. Label figures as measured or estimated, name the
  workload and assumptions, and link evidence. Say unmeasured when no defensible figure exists;
  do not invent savings or claim a neutral cost without evidence. Follow the consumer's privacy
  policy before reporting actual spending, and use approved aggregated or redacted evidence.
- For database changes, inventory added, removed, and changed tables, columns, constraints, and
  indexes. Explain the relationships and conformance to the consumer's schema rules, including
  producer/consumer changes and any justified exceptions. Link the policy and concrete evidence.
- For API, workflow, or independently deployed changes, explain the affected contract, lifecycle,
  or operational safety. Follow the consumer's compatibility and deployment policy.
- A one-line fix with no new scenarios needs only prose. Skip the table and diagram there.

Put long inventories, secondary diagrams, calculations, and failure evidence in collapsed
`<details>` sections. Keep the summary, the main before/after table, the main diagram, and
material risks outside them. Keep the
consumer's required visible core headings outside disclosure containers. Put opening/closing tags
on separate lines, with a blank line after `</summary>` and before `</details>` so Markdown renders.
Read [description examples](references/examples.md) when choosing a comparison, diagram, or failure
record.

Do not fill the description with routine local successful-test lists. This is a reporting rule,
not permission to skip checks: execute required validation and retain its revision, exact scope,
result, and any omission reason in the work's evidence record.

Include **Harness gaps** only after CI diagnosis establishes an omitted local verification or a
proven local/CI mismatch. Link the first failing run/job and its exact head revision, compare the actual local and
CI scope, explain the omission or difference, and record the durable correction or authorized
linked follow-up. Distinguish an omitted check from one that passed locally. Unknown coverage is
not evidence of a miss; classify genuine CI-only or external infrastructure failures separately.
Retain confirmed gap records after CI turns green. Diagnose the failure through the repository's
CI investigation workflow; a failed status alone does not establish a gap.

Create, update, and validate pull requests through the `pr_create`, `pr_update`, and `pr_validate`
MCP tools with structured input, not by hand-writing a body: pass `title`, `summary`, `impact`,
`relatedIssues` (`closes` or `refs`, each with a reason), `details` (Markdown paragraphs or
bullets), `base`, `agent`, optional `model`, `mode`, and `workspaceSetup`. The server renders the
required headings and provenance lines, runs the repository's policy validation, and blocks on its
errors, so put the guidance above into `summary`, `impact`, and `details`. Run `pr_validate` first
to preview the rendered body. `pr_update` preserves the live Shepherd Journal.

Use the repository's approved PR tooling and preserve sections managed by its review automation
verbatim. Close only issues fully resolved and explain non-closing issue links. Apply this guidance
to descriptions being created or updated, not a bulk rewrite of historical pull requests.

Consumer wrapper owns: required headings, source-issue rule, merge policy, repository command, and
hosted review system.
