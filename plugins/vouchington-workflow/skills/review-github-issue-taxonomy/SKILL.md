---
name: review-github-issue-taxonomy
description: Audit GitHub labels, milestones, and path-label automation and return actionable taxonomy recommendations.
---

# Review GitHub issue taxonomy

Use when the taxonomy itself needs review. Remain read-only unless the caller explicitly authorizes
local configuration edits or live taxonomy mutation; read local `AGENTS.md` and `CLAUDE.md` first.

1. Confirm repository identity and fetch live labels, descriptions, colors, usage, milestones, and
   their current scope.
2. Identify automation-owned labels and inspect local label automation before recommending a rename,
   deletion, or rule change.
3. Audit aliases, ambiguity, unused labels, missing descriptions, color consistency, milestone
   overlap, delivery gaps, and path-label coverage.
4. Return exact recommendations with migration impact and separate safe cleanup from decisions that
   require product or scheduling judgment.
5. Re-fetch current state immediately before any explicitly authorized mutation.

Do not create or change labels, milestones, issues, or local files for a recommendation-only
request. This skill does not define a repository's taxonomy or automation file locations.
