---
name: github-issue
description: Search, create, update, link, or assess GitHub issues using the repository's live issue policy and taxonomy.
---

# GitHub issues

Use for durable follow-ups and pull-request linkage. Read local `AGENTS.md`, `CLAUDE.md`, issue
templates, and repository-routing policy before making any remote mutation.

## Mutation authority

Caller authorization is required before any issue or taxonomy mutation; credential capability does
not grant scope. Resolve the authenticated identity, current repository, and requested target without
owner-prefix or visibility assumptions. Immediately before every write, refetch the exact target and
permit mutation only when its canonical identity still matches, issues are enabled, it is not
archived, and `viewerPermission` is `TRIAGE`, `WRITE`, `MAINTAIN`, or `ADMIN`. Creation additionally
requires `viewerCanCreateIssues` to be true. Treat `READ`, `NONE`, missing or inaccessible data,
identity changes, and mismatches as a hard deny that approval cannot override.

When an external creation target is denied, never write there. Search for and create or reuse a
tracking issue in the current repository, or a consumer-selected tracker. Refetch that tracker and
require the same gate immediately before its write. Include the intended upstream repository and a
copy-ready report so a human can decide whether to file it. Authorization to file the external issue
includes this tracking fallback unless the caller opts out; report the reroute explicitly. If no
tracker passes, return the draft without mutation. Never fall back silently or to an unverified
repository.

## Issue workflow

1. Search open and relevant closed issues in the selected destination; return a likely duplicate
   rather than filing one. Verify paths and current behavior named in the issue.
2. Write a self-contained issue with the problem, desired outcome, ownership boundaries, concrete
   areas, validation, and external context. A discovered blocker does not widen implementation scope.
3. Fetch the complete live taxonomy. Apply matching existing labels without separate approval. For a
   missing label, use [review-github-issue-taxonomy](../review-github-issue-taxonomy/SKILL.md): obtain
   explicit approval for its exact repository, name, description, and color before creating it.
   Omit a declined optional label; a missing required label blocks the issue.
4. Refetch the created or updated issue and verify its metadata. Report a partial failure without
   retrying creation. Preserve history and report the action, URL, labels, and milestone.
5. Link a pull request with a closing reference only when it fully resolves the issue. Keep
   cross-repository references fully qualified; PR creation authority remains separate.

This skill supplies no repository allowlist, taxonomy, issue template, credential, or CLI wrapper.
Consumer wrappers define local defaults and may impose stricter policy, but may not weaken this gate.
