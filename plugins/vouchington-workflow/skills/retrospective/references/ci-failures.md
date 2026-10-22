# CI failures

A retrospective's `## CI Failures` section is an observed-failures log, not a historical audit of the
hosting service. Build it from the session journal alone, as the composer does. Transcript output
cannot establish CI status. Do not crawl workflow history for failures the session never observed,
and do not infer that none occurred because the final run passed.

Use exactly one status line:

- `Status: failures observed`
- `Status: none observed`, only when the journal was readable and showed no failures
- `Status: unavailable (<reason>)`, when the journal cannot establish whether failures occurred,
  such as an unreadable journal or a session unknown to the journal; the reason is non-blank

## Journal block

Journal a CI failure in this grammar, one block per root cause rather than per run. A flake counts,
even one that passed on a later run with no code change. Record whether it was flaky, the gotcha, and
how to reach passing CI in fewer commits:

```
- `recurring|one-off` — `GitHub Actions` — <check name>: <gotcha, or flaky: <test>>
  - Evidence: <run URL and commit>
  - Root diagnostic: <first actionable error, with the affected test, file, or symbol; for a flake, the nondeterminism observed>
  - Disposition: <fix commit, unresolved with issue #N, or infrastructure/pre-existing with evidence>
```

A consumer wrapper may add fields to `Disposition` (for example, whether a test-selection tool chose
the failing test). Keep any such field when grouping.

## Grouping

- Group repeated occurrences by root signature and state the occurrence count when one signature
  hit several pushes.
- Report the first or root failure, not downstream aggregate or fan-in failures.
- Keep an earlier failure even when a later attempt passes.
- Hosted CI jobs are in scope; external checks are out of scope unless the failure was emitted
  inside such a job.
- Never paste complete logs, environment dumps, credentials, or tokens.

## Wording rules

- Use "direct-to-main" only when `git branch -r --contains <sha>` lists the default branch's remote
  ref and the commit is on that branch's first-parent history. An unmerged branch is "committed to
  topic branch X, unmerged at retrospective time".
- Pair every commit count with a push count. The expensive unit is the push, which triggers CI and
  bot reviewers: write "N pushes (M commits), each retriggering CI", not "N fix commits".
- Count bot review rounds as distinct pushes that triggered a review cycle, not individual comments.
