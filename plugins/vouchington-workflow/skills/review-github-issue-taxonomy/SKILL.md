---
name: review-github-issue-taxonomy
description: Audit GitHub labels, milestones, projects, and path-label automation and return actionable taxonomy recommendations.
---

# Review GitHub issue taxonomy

Use when the taxonomy itself needs review. Remain read-only unless the caller explicitly authorizes
local configuration edits or live taxonomy mutation; read local `AGENTS.md` and `CLAUDE.md` first.

1. Confirm repository identity and fetch live labels, descriptions, colors, usage, milestones, open
   and closed projects, and their current scope.
2. Identify automation-owned labels and inspect local label automation before recommending a rename,
   deletion, or rule change.
3. Audit aliases, ambiguity, unused labels, missing descriptions, color consistency, milestone
   overlap, delivery gaps, and path-label coverage. Audit projects too: a milestone theme duplicated
   across repositories is a candidate project, and a project confined to one repository is a
   candidate milestone. Flag a project with no description, an empty or stale project, a closed
   project with open items, an issue that belongs to more than one project, and a project's own
   automation for auto-adding a parent issue's sub-issues left enabled where the at-most-one-project
   rule applies — it can silently duplicate membership.
4. Return exact recommendations with migration impact and separate safe cleanup from decisions that
   require product or scheduling judgment. Applying an existing label is not taxonomy creation and
   needs no separate approval from the authorized issue operation.
5. Before creating a label, stop for explicit approval naming its exact repository, name,
   description, and color. Re-fetch current state and enforce the taxonomy-definition gate from
   [github-issue](../github-issue/SKILL.md): require `WRITE`, `MAINTAIN`, or `ADMIN` and the
   label-specific API capability immediately before the approved mutation. `viewerCanCreateIssues`
   applies only to issue creation. Approval for an issue or another label does not transfer.

Do not create or change labels, milestones, projects, issues, or local files for a
recommendation-only request. This skill does not define a repository's taxonomy or automation file
locations; a consumer wrapper supplies those integrations and local mechanics.
