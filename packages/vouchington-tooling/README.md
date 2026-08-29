# vouchington-tooling

Libraries and the `vouchington` CLI.

```bash
npm install vouchington-tooling
# optional, only if you import vouchington-tooling/sql-ast
npm install @libpg-query/parser
# optional, only for vouchington-tooling/agent-blackboard and agent-blackboard CLI commands
npm install agent-blackboard@^0.3.1
```

## CLI

```bash
vouchington --help
vouchington runner-port-policy
vouchington runner-port-policy --file ./policy.json
vouchington runner-port-policy --reserved 2200
vouchington with-host-lock --name expensive-build --timeout-seconds 60 -- make build
vouchington gha-runtime-audit --pr-workflow CI --push-workflow '/^Main CI \\(.+\\)$/'
vouchington gha-output name
vouchington gha-needs-results
vouchington download-with-diagnostics <url> <destination>
vouchington download-optional-run-artifacts --pattern 'coverage-*' --dir ./coverage-fallback
vouchington host-pressure-diagnostics
vouchington allocate-browser-safe-ports 2 --policy ./policy.json --forbidden-ports ./ports.json
vouchington diagnose-port-collision --ports "2200 2216"
vouchington prepare-trivy-db
vouchington gha-artifacts-cleanup run --run-id 123 --keep-pattern 'plan-*' --delete-pattern 'coverage-*'
vouchington http-origin --field cdn_origin https://images.example.com
vouchington vitest-blob-manifest <suite> [reports-directory]
vouchington pnpm-install --runner-lifecycle persistent --install-scripts true
vouchington check-cache-size /tmp/cache 1048576 node-modules
vouchington make-shard-matrix 4
vouchington load-runner-env
vouchington clean-workspace
vouchington install-github-release --repo lycheeverse/lychee --version 0.24.2 --asset 'lychee-{platform}.tar.gz' --bin lychee
vouchington run-with-timeout 120 10 docker push example
vouchington lint-links --offline
vouchington materialize-pr-context
vouchington wait-for-apt-locks
vouchington retrospective-transcript --jsonl /path/to/transcript.jsonl
vouchington retrospective-facts --pr 49 --repo vouchington/vouchington-infra --raw
vouchington agent-blackboard probe
vouchington agent-blackboard journal append --session-id <uuid> --agent codex --version 1 --file note.md
vouchington agent-blackboard journal entries --session-id <uuid>
vouchington agent-blackboard snapshot partition --snapshot <snapshot.jsonl> --checksum <sha256> --counts <counts.json>
vouchington agent-blackboard snapshot cleanup --snapshot <snapshot.jsonl> --partition-directory <partitions-dir> --receipt <receipt-json>
vouchington install-playwright-chromium-arm64
vouchington ghcr-package-retention example%2Fapi
vouchington nuget-central-version trusted.props candidate.props metadata.json out.props
vouchington swift-semantic-equal BASE HEAD App.swift
vouchington post-review
vouchington stage-review-payload optional|required <source> <destination>
```

For persistent `pnpm-install`, v4 metadata tracks structural inputs separately from the
`--install-scripts` policy. A warm scripts-enabled tree can therefore toggle
`true → false → true` without forced reconciliation; a tree first installed with scripts disabled
uses one script-suppressed verification install followed by `pnpm rebuild --pending --recursive`.
When only newly pending dependency package IDs remain, it instead rebuilds those exact IDs without
rerunning first-party workspace hooks.
The command emits a structured non-secret provenance diagnostic identifying changed structural
categories, the last script policy, script capability, and native-binary health.

`download-optional-run-artifacts` uses the current Actions run and host. Pattern mode discovers
non-expired artifacts across the run, keeps the first result for each name (matching `gh run
download`), and extracts each selected name into its own directory. Ordinary absence is reported as
`availability=unavailable`. Artifact listing retries up to three times with bounded backoff;
exhausted transport errors, invalid names, and cancellation remain hard failures.

`retrospective-transcript` discovers Codex and Claude transcripts by default. It also reads a
Claude-compatible transcript when `CURSOR_SESSION_ID` is set, and Grok's `updates.jsonl` session
layout when `GROK_SESSION_ID` is set. Use `--grok-sessions-dir` to point discovery at a nondefault
Grok session root. Without `--session-id`, it reads those session identities from the host
environment.

`retrospective-facts` keeps local Git evidence separate from GitHub PR data. `Commits ahead of
origin/main` is populated only from a local ancestry range; GitHub responses instead populate
`PR commits`. API-derived file and directory counts are labelled `GitHub API`. When a named local
branch is absent, the command refreshes `origin/<branch>` before using it and refuses a stale
remote ref when that refresh fails.
For an explicit `--repo`, it performs no local Git checks: `Merged to main` is `yes` only when
GitHub reports a merged PR whose `baseRefName` is `main`; a merged PR into another base is reported
as not merged to main, and a missing base is unavailable.

Agent Blackboard support is optional: only the `agent-blackboard` subpath and its CLI commands
need `agent-blackboard@^0.3.1`. Snapshot cleanup accepts only package-generated temporary paths.
It captures a target under a private tombstone, validates partition names, permissions, JSONL,
ordering, terminal manifests, and the identity-bound cleanup receipt before deleting files, and
restores the original path on a validation failure. Once deletion begins, it retains a private
tombstone plus signed resume metadata instead; retry cleanup with the original partition-directory
path and the same receipt until it completes. The partition command returns that receipt; directory
cleanup requires it.
The receipt is authenticated with an owner-only per-user HMAC key stored under a dedicated
`0700` directory in the system temporary directory. This small host-local state is the trust
boundary: a copied or caller-created receipt cannot authorize cleanup without that key.

Host-lock environment:

| Variable                                | Default               | Meaning                                     |
| --------------------------------------- | --------------------- | ------------------------------------------- |
| `HOST_LOCK_ROOT`                        | `/tmp/host-lock-$UID` | Absolute lock directory root                |
| `HOST_LOCK_LEASE_SECONDS`               | `60`                  | Reclaim ceiling for a held lock             |
| `HOST_LOCK_PROCESS_GROUP_DRAIN_SECONDS` | `30`                  | Time to wait for the command process group  |
| `HOST_LOCK_ACTIVE`                      | unset                 | Set while a lock is held; nested locks fail |

## Library

```ts
import {
  isRunnerReservedPort,
  listenOnRunnerUnreservedEphemeralPort,
  runnerPortPolicy,
} from 'vouchington-tooling/runner-port-policy'
import { initSqlAst, extractCreateTableMetadata } from 'vouchington-tooling/sql-ast'
import { splitSqlStatements, stripSqlComments } from 'vouchington-tooling/sql-scanner'
import { auditCiJobRuntime } from 'vouchington-tooling/gha-runtime-audit'
import {
  readVitestReportAttempts,
  writeVitestBlobManifest,
} from 'vouchington-tooling/vitest-blob-manifest'
import { prepareVitestReports } from 'vouchington-tooling/vitest-reports'
import { runInstallLifecycle, validateReleaseAgePolicy } from 'vouchington-tooling/pnpm-install'
import {
  buildSharedContext,
  installFakeGit,
  runNamedChecks,
} from 'vouchington-tooling/shared-context'
import {
  decodeSelectedFiles,
  writeSelectedFilesOutput,
} from 'vouchington-tooling/gha-selected-files'
import { createArtifactClassifier, runCleanup } from 'vouchington-tooling/gha-artifacts-cleanup'
import { validateOptionalHttpOrigin } from 'vouchington-tooling/http-origin'
import { boundPendingLine, splitCompleteLines } from 'vouchington-tooling/process-line-buffer'
import {
  isProcessGroupAlive,
  runBrowserSession,
  waitForProcessGroupExit,
} from 'vouchington-tooling/browser-session-runner'
import {
  generateSchemaSnapshot,
  renderSchemaMarkdown,
} from 'vouchington-tooling/pg-schema-snapshot'
import { buildOpenApiDocument, writeOpenApi } from 'vouchington-tooling/openapi-document'
import { decide, deriveRetryAttempt } from 'vouchington-tooling/transient-retry'
import { parseCsvRows, streamCsvRows } from 'vouchington-tooling/csv'
import { readResponseBody } from 'vouchington-tooling/http-body'
import { runAstGrepRule } from 'vouchington-tooling/ast-grep-rule'
import { parseReviewPayload, remapReviewComments } from 'vouchington-tooling/gha-review-payload'
import { runPostReview } from 'vouchington-tooling/gha-post-review'
import { nextPageUrlFromLinkHeader } from 'vouchington-tooling/http-link-pagination'
import {
  cmdUpload,
  discoverDownloadControl,
  mintPrefixUploadControl,
} from 'vouchington-tooling/coverage-transport'
import { pruneDeployedRuntimeDeps } from 'vouchington-tooling/pnpm-deploy'
import { parseDockerfileRuntimeImages } from 'vouchington-tooling/dockerfile-parse'
import { checkSccComplexity } from 'vouchington-tooling/scc-complexity'
import { runCiLocal } from 'vouchington-tooling/ci-local'
import { rateLimitDelay } from 'vouchington-tooling/gha-rate-limit'
import { parseCheckpoint } from 'vouchington-tooling/gha-pr-checkpoint'
import { checkWorkspaceGatesPolicy } from 'vouchington-tooling/workspace-gates'
import { validateNugetUpdate } from 'vouchington-tooling/nuget-central-version'
import { normalizeSwiftSource } from 'vouchington-tooling/swift-semantic-equal'
import { parseUniqueSwiftBinaryTargetChecksum } from 'vouchington-tooling/swift-source-offset'
import { validateResolvedPinDelta } from 'vouchington-tooling/swift-resolved-pin-delta'
import {
  formatDiagnosticReportSummaries,
  readDiagnosticReportSummaries,
} from 'vouchington-tooling/vitest-diagnostics'
import { runRetrospectiveTranscript } from 'vouchington-tooling/retrospective-transcript'
import { appendJournal, probeBlackboard } from 'vouchington-tooling/agent-blackboard'
import { buildSessionFrictionReport, recordFriction } from 'vouchington-tooling/session-friction'
```

`session-friction` is an opt-in capture and reporting library. Callers supply the session id,
absolute log directory, host-independent observation, and journal loader; it does not inspect host
environment variables, install hooks, or connect to a journal service by itself. Invoking
`recordFriction` touches the session log even when no event is classified, preserving the
difference between an observed clean session and missing evidence. Report markdown keeps backend
diagnostics separate from its paste-safe output. Capture stores at most 500 events per session,
truncates event detail to 1,000 characters, and consumes up to 500 entries from the journal loader
when building a report, stopping earlier when its aggregate 1 MB inspected-byte budget is reached.
Bounded journal scans that stop before exhaustion are reported as incomplete rather than clean.
Report liveness inherits the caller-supplied journal loader, which must bound its own I/O and yields.
Log reads are capped at 2 MB, journal Markdown at 10,000 bytes per entry,
and rendered audit fields at 120 escaped characters. The supplied log directory must be dedicated
to session-friction; existing directories must already be owner-only, while newly created
directories and log files are enforced as owner-only when recording. Reads use a fixed bounded
buffer that can detect growth one byte beyond the documented 2 MB cap.
Ownership checks require POSIX effective-user IDs (Linux and macOS); session-friction throws on
Windows and other platforms where those IDs are unavailable.
Root-owned system symlink ancestors are supported for paths such as macOS `/var`; callers must not
allow the directory chain to be mutated while it is being validated.
Command-prefix normalization recognizes simple shell
segments with single or double quotes; it does not evaluate substitutions or implement a full shell
grammar. Normalization attempts limited redaction of obvious credential patterns but is not a secret
scrubber; callers must ensure credentials are never included in captured commands.
Failure classification inspects at most 100,000 structured-stderr characters, split evenly between
the beginning and end when input exceeds that bound.
Cooperating log readers and writers are serialized, including the initial clean-session
touch. Recording and report log reads are synchronous: on contention they block the caller's
event loop for up to one second before failing explicitly. Avoid these APIs on hot request paths.

The artifact, review-payload, HTTP body, and pagination APIs validate untrusted inputs at their
boundaries. Review posting lives in `gha-post-review` and talks to GitHub only through caller-supplied
credentials (job token or a minted Claude GitHub App token).

`vitest-diagnostics` reads Node diagnostic report JSON from a caller-selected directory. It sorts
filenames, tolerates partial files, returns only a bounded field allowlist, and never emits raw
native frame symbols. Both structured reads and text rendering have hard report-count limits.

`browser-session-runner` supervises caller-created browser-test processes. Callers supply command
construction, line classification, retry/outcome policy, and budgets; the library owns process-group
termination, output line buffering, shared deadlines, progress watchdogs, diagnostics, and parent signals.
The returned process must identify a dedicated process group, such as a child spawned with
`detached: true`; its `processGroupId` is signalled without assuming the child PID is a group ID.
Stall exits use the caller's `classifyExit` policy, while parent signals and shared-deadline expiration
are terminal. Output is decoded independently per stream; unfinished lines are classified at close and
`diagnosticTailBytes` retains a UTF-8-safe tail no larger than its byte budget.
The runner uses monotonic elapsed time, rejects timer budgets above Node's maximum delay, and waits for
the dedicated process group to exit after the direct child closes so descendants cannot overlap a retry.
`isProcessGroupAlive` and `waitForProcessGroupExit` are also available when callers need the same
process-group probe and bounded-drain semantics outside a browser session.

## Workflow skills outside plugins

The package ships a flat union of canonical workflow, testing, and database skills at
`skills/<skill>/SKILL.md`. This stable installed path supports agents that do not load Claude or
Codex plugins. The package build materializes plugin source trees without hand-copying skill content
and writes sorted schema-v1 provenance to `skills/manifest.json`.
Each manifest entry may declare its ordered `prerequisites`; ordinary Markdown links remain
cross-references and never cause additional skills to be linked.

Use `readSkillManifest(skillsRoot)` to discover installed skills or
`linkSkill({ name, sourceRoot, targetRoot })` to link one into an explicit consumer directory. The
CLI equivalent is `vouchington link-skill <name> --source-root <skills-dir> --target-root <dir>`.
It rejects unknown names, paths outside either root, and existing non-matching destinations.
`targetRoot` must already exist as a physical directory path: symlinked target roots or ancestors are
rejected.
