# vouchington-tooling

Libraries and the `vouchington` CLI.

```bash
npm install vouchington-tooling
# optional, only if you import vouchington-tooling/sql-ast
npm install @libpg-query/parser
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
vouchington fetch-repository-paths --config ./bundle.json --destination "$RUNNER_TEMP/bundle" --metadata "$RUNNER_TEMP/bundle.json" --token-env BUNDLE_TOKEN
vouchington install-github-release --repo lycheeverse/lychee --version 0.24.2 --asset 'lychee-{platform}.tar.gz' --bin lychee
vouchington run-with-timeout 120 10 docker push example
vouchington lint-links --offline
vouchington materialize-pr-context
vouchington wait-for-apt-locks
vouchington retrospective-transcript --jsonl /path/to/transcript.jsonl
vouchington install-playwright-chromium-arm64
vouchington ghcr-package-retention example%2Fapi
vouchington nuget-central-version trusted.props candidate.props metadata.json out.props
vouchington swift-semantic-equal BASE HEAD App.swift
vouchington post-review
vouchington stage-review-payload optional|required <source> <destination>
```

### Repository path fetch

`fetch-repository-paths` requires Node 24+, fetches only the schemaVersion-1 config's mapped paths, resolves the requested ref to an immutable SHA, verifies every selected Git blob, and creates private staged output before publishing. Destination and metadata must not already exist. Metadata contains the resolved SHA, sorted file hashes, and deterministic bundle digest.

Use it only from a trusted `pull_request_target` job: configuration, requested ref, and pinned action SHA must come from trusted base content, never the pull-request head. Keep the read token solely in that trusted job; pass only its fetched artifact to untrusted test jobs.

The same implementation is available to workflows through the pinned composite action:

```yaml
- uses: vouchington/vouchington-tooling/.github/actions/fetch-repository-paths@<sha>
  with:
    config: ${{ runner.temp }}/bundle.json
    destination: ${{ runner.temp }}/bundle
    metadata: ${{ runner.temp }}/bundle-metadata.json
    token: ${{ steps.token.outputs.token }}
```

Source the reusable check reporting library with `source "$(node -p \"require.resolve('vouchington-tooling/native-check-harness.sh')\")"`, then call `native_check_init <markdown> <jsonl>`; it writes stable machine JSONL beside Markdown while consumer scripts retain their own check commands.

`retrospective-transcript` discovers Codex and Claude transcripts by default. It also reads a
Claude-compatible transcript when `CURSOR_SESSION_ID` is set, and Grok's `updates.jsonl` session
layout when `GROK_SESSION_ID` is set. Use `--grok-sessions-dir` to point discovery at a nondefault
Grok session root. Without `--session-id`, it reads those session identities from the host
environment.

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
```

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

The package ships the canonical Vouchington workflow skill tree at
`skills/<skill>/SKILL.md`. This stable installed path supports agents that do not
load Claude or Codex plugins. The Claude and Codex plugin manifests continue to reference the same
canonical source tree under `plugins/vouchington-workflow/skills`; package build materializes that tree
without hand-copying skill content.
