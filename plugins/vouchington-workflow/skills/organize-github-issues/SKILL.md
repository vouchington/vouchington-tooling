---
name: organize-github-issues
description: Apply existing issue and PR taxonomy within the requested scope.
---

# Organize GitHub issues

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/organize-github-issues/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Use for issue hygiene, priority normalization, milestone assignment, and project membership. Read
local `AGENTS.md`, and live taxonomy guidance before acting.

1. Confirm repository identity. Fetch live labels, milestone descriptions, open project
   descriptions, and the in-scope issue or pull-request evidence. Before a mutation, apply the
   operation-specific gate from the `github-issue` skill (`skills` plugin). Pull-request metadata
   does not require issues to be enabled.
2. Classify from the permitted metadata and discussion. Do not guess from the implementation. Keep
   automation, ownership, and provenance labels unless local policy explicitly allows a change.
3. Apply only existing labels, milestones, and projects without requesting separate label approval.
   Follow [Projects and milestones](#projects-and-milestones) for single-project membership,
   auto-added sub-issues, and a status that closes the issue. Do not create taxonomy, close work, rewrite
   bodies, or change titles unless the caller separately authorizes that scope.
4. In review mode, report the exact proposed metadata changes and do not mutate. In apply mode,
   make only necessary, idempotent updates.
5. Refetch every touched item. Verify the requested metadata, including project membership, and
   confirm protected metadata stayed intact. After a project add, report any additional item the
   project's automation pulled in, such as a parent issue's sub-issues. Report changed, unchanged,
   and ambiguous items separately.

## Projects and milestones

- Use an existing open project for strategic, initiative-level tracking and a milestone for
  repo-local release or sequencing. Choose by the initiative, not by how many repositories it
  touches. An initiative can have both. An issue belongs to at most one project, and not every
  issue needs one.
- Before adding a project item, check that item and any item the project's automation could pull
  in with it, such as a parent issue's sub-issues. If any already belongs to a different project,
  skip the add and report the conflict. After the add, re-read the project.
- Missing project scope or permission skips the project step only. Report the gap; the issue and
  its other metadata still proceed.
- Do not set a project status that closes the issue unless closing is separately authorized.
  GitHub's Auto-close issue workflow closes the issue when status becomes Done.
- A plan issue takes its source's milestone. When the source already has a project, refetch
  memberships and apply that project only when exactly one accessible open membership exists;
  otherwise skip the project and report the conflict.

Consumer wrapper owns: priorities, labels, milestones, projects, clarification policy, default
scope, and permissions.
