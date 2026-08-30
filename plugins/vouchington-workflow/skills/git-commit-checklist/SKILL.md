---
name: git-commit-checklist
description: Use before staging and committing changes to verify scope, validation, commit metadata, and local repository policy.
---

# Git commit checklist

Use before every commit. Read local `AGENTS.md`, `CLAUDE.md`, contribution guidance, and hook
output first; they own commit format, required trailers, file-size limits, and validation commands.

1. Inspect `git status` and the complete diff. Stage only files that implement the accepted task.
2. Confirm new or changed source and test files meet local size, formatting, and generated-file
   policy. Do not commit credentials, build outputs, editor state, or unrelated changes.
3. Run focused tests and required local checks. Record any permitted skipped check and why.
4. Use the repository's conventional subject and required body/trailers. If code was extracted,
   record the required provenance in the commit body.
5. Re-read the staged diff and commit message before committing. Do not amend another author's
   work or rewrite history unless local policy and explicit authorization allow it.

This skill does not prescribe branch names, file-size budgets, commit conventions, PR templates,
or push commands. Supply those through repository-local instructions or a consumer wrapper.
