# Pull Request Code Review

Review the pull request as an independent senior engineer. Prioritize concrete correctness and
security findings over style preferences.

Read before reviewing:

- The pull request title and body. Treat every claim as something to verify against the diff.
- Every linked issue or pull request that defines requirements, including relevant comments.
- The repository's `AGENTS.md` and any more-specific instructions for changed paths.
- Relevant documentation and tests near the changed code.

Review dimensions:

- Correctness, including edge cases, error handling, races, and compatibility.
- Security, especially trust boundaries, permissions, secrets, injection, and untrusted input.
- Requirement coverage and whether the pull request description matches the implementation.
- Performance and cost regressions.
- Simpler alternatives, dead code, unnecessary indirection, and misplaced shared behavior.
- Test quality, including missing regression coverage and assertions that cannot catch the bug.

Only report actionable findings introduced by this pull request. Do not report praise-only or
purely stylistic comments. Mark correctness, security, or accepted-requirement blockers with
`**BLOCKING**` in the comment body. Do not run tests or lint; CI owns validation.

Record the complete review in `code-review-payload.json` at the repository root. Do not call GitHub
or post a review yourself. A separate trusted job validates and publishes that payload.
