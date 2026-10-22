# Issue body template

Use this shape for a new issue and for a comment on an existing one. The body must be fully
self-contained: the source sessions are archived afterward, so never reference a session id, a
retrospective file name, or a local journal path. Embed the relevant evidence instead.

For a comment, open with a line such as "Additional context from recent retrospectives". Omit
`## Root cause` when the issue already documents it, or retitle it `## Additional root cause
context` when the comment adds new information.

```markdown
## Root cause

<the underlying process or tooling gap; for a recurring theme, why it keeps happening>

## Problem

<symptoms with concrete PR and commit references>

## Proposed fixes

- [ ] <each fix as a checkbox with the file path it touches>

## Files / areas

- <existing paths verified at HEAD, and proposed paths marked `New`>

## Context

<evidence lifted from the source records: the specific reflection text, root-cause notes, concrete
paths, and the relevant verifiable-fact figures (push and commit counts, diff scope) that motivated
the theme. Use only durable references: PR #N, issue #N, and the retrospective date (YYYY-MM-DD).>
```

Journal entries are unminimized notes and can carry credentials or sensitive local context. Summarize
a finding in your own words; never paste a command line or stderr, and strip any long opaque token,
`VAR=value` assignment, or credential-bearing URL. Checking a claim against the remote default branch
verifies its accuracy; it does not sanitize the text.

Apply the path rules of [github-issue](../../github-issue/SKILL.md) to `## Files / areas`.
