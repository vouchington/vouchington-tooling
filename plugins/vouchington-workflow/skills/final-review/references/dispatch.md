# Dispatch: effort and pillar selection

Decide mechanically from the effort level and the changed paths, then record every skipped pillar
and its reason in the verifier input's `skipped` list.

## Effort

| Effort           | When                                                  | Diff reviewed               | Pillars                                                                          |
| ---------------- | ----------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `high` (default) | First review of a pull request, or the requester asks | Full pull request           | Every pillar the rules below select                                              |
| `medium`         | Requester asks; mid-sized follow-ups                  | Full pull request           | rules, correctness, design, blast-radius; security and history only on a trigger |
| `low`            | Follow-up review after fixes                          | Since the last reviewed SHA | correctness, plus each pillar that had an unresolved finding last time           |

At `low`, the verifier also rechecks every previous finding against the new head (fixed, still
present, or no longer applicable). Fall back to `high` when the last reviewed SHA is not an
ancestor of the new head (force-push or rebase that rewrote it), or when the new commits change
more than half of the pull request's lines.

## Path rules

- **Docs-only** (every changed file is Markdown, text, or under `docs/`): rules and congruence
  only.
- **Dependency-bot pull requests**: rules (dependency policy) and blast-radius for major bumps;
  security when lockfiles add new packages. Usually handled by triage instead of a final review.
- **Security trigger**, any of these:
  - auth, session, token, permission, crypto, secret, or password code;
  - `.github/workflows/**` or `action.yml`;
  - Dockerfiles, shell scripts, SQL, or migrations;
  - HTTP handlers, parsers, or file uploads;
  - dependency manifests or lockfiles that add packages.
- **History trigger**: `git log --since=12.months --format=%s -- <changed files>` at the base ref
  shows `Revert`, `revert`, `hotfix`, or a `fix:` commit landing within 14 days of the change it
  fixed.
- **Blast radius** always runs at high and medium unless the change is docs-only or test-only.

## Models

Pillars run on the implementation tier (Claude: Sonnet, medium effort; Codex: Sol medium). The
verifier runs on the strongest tier (Claude: Opus). The correctness pillar invokes the host's
built-in code review at low effort when one exists.
