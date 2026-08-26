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
require its canonical identity to still match and the repository not to be archived. Issue operations
also require issues to be enabled and `viewerPermission` of `TRIAGE`, `WRITE`, `MAINTAIN`, or `ADMIN`;
issue creation additionally requires `viewerCanCreateIssues`. Applying existing metadata to a pull
request uses the same permission set but does not require issues to be enabled. Creating, changing, or
deleting taxonomy definitions requires `WRITE`, `MAINTAIN`, or `ADMIN` plus the operation-specific API
capability. Treat insufficient permission or capability, missing or inaccessible data, identity
changes, and mismatches as a hard deny that approval cannot override.

When an external creation target is denied, never write there. Search for and create or reuse a
tracking issue in the current repository, or a consumer-selected tracker. Immediately before that
write, refetch the destination repository and apply the issue-operation gate above. Include the
intended upstream repository and a copy-ready report so a human can decide whether to file it. Before
copying details to a less-restricted destination, remove private repository identity, paths, links,
code, and findings; if redaction would make the report unusable, require explicit destination approval
or return the draft without mutation. Authorization to file the external issue includes this tracking
fallback unless the caller opts out; report the reroute explicitly. If no tracker passes, return the
draft without mutation. Never fall back silently or to an unverified repository.

## Issue workflow

1. Search open and relevant closed issues in the selected destination; return a likely duplicate
   rather than filing one. Verify paths and current behavior named in the issue.
2. Write a self-contained issue with the problem, desired outcome, ownership boundaries, concrete
   areas, validation, and external context. A discovered blocker does not widen implementation scope.
3. Fetch the complete live taxonomy. Apply matching existing labels and a selected existing milestone
   without separate approval. Omit a missing optional milestone; a missing required milestone blocks
   the issue, and milestone creation is a separately authorized taxonomy operation. For a
   missing label, use [review-github-issue-taxonomy](../review-github-issue-taxonomy/SKILL.md): obtain
   explicit approval for its exact repository, name, description, and color before creating it.
   Omit a declined optional label; a missing required label blocks the issue.
4. Refetch the created or updated issue and verify its metadata. Report a partial failure without
   retrying creation. Preserve history and report the action, URL, labels, and milestone.
5. Link a pull request with a closing reference only when it fully resolves the issue. Keep
   cross-repository references fully qualified; PR creation authority remains separate.
6. Use native sub-issues only for real hierarchy, blocked-by relationships only for genuine known
   dependencies, and prose links for merely related work. Read every created relationship back.

For batch creation, preflight every entry before writing any issue and fail the whole batch when one
entry is invalid. A partial transport failure stops further creation and reports every issue already
created; never retry successful entries.

This skill supplies no repository allowlist, taxonomy, issue template, credential, or CLI wrapper.
Consumer wrappers define local defaults and may impose stricter policy, but may not weaken this gate.
