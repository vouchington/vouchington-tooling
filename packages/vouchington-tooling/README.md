# vouchington-tooling

Libraries and the `vouchington` CLI.

The [workflow and compiler primitives](docs/workflow-and-compiler.md) provide consumer supplied
GitHub Actions policy checks and compiler host freshness with bounded build settlement.

[`config-inventory`](../../docs/config-inventory.md) collects environment, dynamic-configuration,
and package-manager evidence using caller-owned file roles and policies.

[`finite-enum-ripple`](../../docs/finite-enum-ripple.md) compares finite TypeScript declarations,
route configuration, routed pages, and factory calls. Consumers supply every tracked-file role,
declaration name, route label, factory pattern, and exception.

```bash
npm install vouchington-tooling
# optional, only if you import vouchington-tooling/sql-ast
npm install @libpg-query/parser
# optional, if you import vouchington-tooling/contract-schema, finite-enum-ripple,
# or post-publication-inventory
# (classic compiler API; typescript@7's package root is version-only)
npm install @typescript/typescript6
# optional, only if you use the Vitest reporter export
npm install vitest
# optional, only for vouchington-tooling/agent-blackboard and agent-blackboard CLI commands
npm install agent-blackboard@^0.6.0
# optional, only for `vouchington mcp` (zod is a peer of the SDK)
npm install @modelcontextprotocol/sdk zod
```

[`vouchington mcp`](docs/mcp-server.md) serves the agent-blackboard journal tools to an agent over
stdio, with Claude, Codex, and Cursor registration examples.

## CLI

```bash
vouchington --help
vouchington runner-port-policy
vouchington runner-port-policy --file ./policy.json
vouchington runner-port-policy --reserved 2200
vouchington with-host-lock --name expensive-build --timeout-seconds 60 -- make build
vouchington gha-runtime-audit --pr-workflow CI --push-workflow '/^Main CI \\(.+\\)$/'
vouchington require-up-to-date --remote origin --branch main
vouchington gitleaks-directory-scan --config .gitleaks.toml
vouchington ast-grep-examples --rules ast-grep-tests --config sgconfig.yml
vouchington ast-grep-pack
vouchington gha-workspace-policy
vouchington gha-output name
vouchington gha-needs-results
vouchington download-with-diagnostics <url> <destination>
vouchington download-optional-run-artifacts --pattern 'coverage-*' --dir ./coverage-fallback
vouchington download-optional-run-artifacts --name coverage-tooling --name coverage-web --dir ./coverage-fallback
vouchington host-pressure-diagnostics
vouchington allocate-browser-safe-ports 2 --policy ./policy.json --forbidden-ports ./ports.json
vouchington diagnose-port-collision --ports "2200 2216"
vouchington prepare-trivy-db
vouchington gha-artifacts-cleanup run --run-id 123 --keep-pattern 'plan-*' --delete-pattern 'coverage-*'
vouchington http-origin --field cdn_origin https://images.example.com
vouchington vitest-blob-manifest <suite> [reports-directory]
vouchington vitest-report-attempt write <directory> <suite>
vouchington vitest-report-attempt read <root>
vouchington prepare-vitest-reports [primary-directory] [fallback-directory] [output-directory]
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
vouchington agent-blackboard journal append --session-id <uuid> --agent codex --version 1 --file note.md --repository owner/repo --mode autonomous --source-event-id event:1 --work-outcome in-progress --coverage-status partial --timestamp 2026-01-01T00:00:00.000Z
vouchington agent-blackboard journal entries --session-id <uuid>
vouchington agent-blackboard snapshot partition --snapshot <snapshot.jsonl> --checksum <sha256> --counts <counts.json>
vouchington agent-blackboard snapshot cleanup --snapshot <snapshot.jsonl> --partition-directory <partitions-dir> --receipt <receipt-json>
vouchington mcp
vouchington install-playwright-chromium-arm64
vouchington ghcr-package-retention example%2Fapi
vouchington harness-admission-lane 4
vouchington harness-assert-gates HARNESS_DISPATCH_ENABLED HARNESS_SHEPHERD_ENABLED
echo '[{"login":"octocat","type":"User"}]' | vouchington gha-collaborator-trust owner/repo --allow-bot github-actions[bot]
vouchington nuget-central-version trusted.props candidate.props metadata.json out.props
vouchington swift-semantic-equal BASE HEAD App.swift
vouchington post-review
vouchington stage-review-payload optional|required <source> <destination>
```

For persistent `pnpm-install`, v5 metadata tracks structural inputs separately from the
`--install-scripts` policy. A warm scripts-enabled tree can therefore toggle
`true → false → true` without forced reconciliation; a tree first installed with scripts disabled
uses two script-suppressed verification installs followed by `pnpm rebuild --pending --recursive`.
Before rebuilding, duplicate pending IDs are collapsed. After rebuilding, IDs proven absent from
the current workspace and installed virtual-store lockfiles are reported and removed; live
dependency and workspace-importer IDs are retained. Any residual ID after the generic rebuild remains a reported hard failure. An isolated native-binary
mismatch uses one strict forced install only when structural provenance
matches, workspace links are valid, and pnpm records empty `ignoredBuilds` and `pendingBuilds` ledgers;
otherwise it retains the two script-free reconciliation passes. Native and workspace-link health
are verified before its metadata stamp is refreshed.
The command emits a structured non-secret provenance diagnostic identifying changed structural
categories, the last script policy, script capability, and native-binary health.

`download-optional-run-artifacts` uses the current Actions run and host. Pattern mode discovers
non-expired artifacts across the run, keeps the first result for each name (matching `gh run
download`), and extracts each selected name into its own directory. Ordinary absence is reported as
`availability=unavailable`. Artifact listing retries up to three times with bounded backoff;
exhausted transport errors, invalid names, and cancellation remain hard failures.

Name mode takes one or more `--name <artifact>` flags (mutually exclusive with `--pattern`), lists
the run's artifacts once, and extracts every requested name that is present into `<dir>/<name>`.
Names are matched literally, in request order, with repeats downloaded once; empty names, `.`, `..`,
and names containing `/`, `\`, or a line break are rejected before anything is listed. Requested
names absent from the run are expected (callers pass a superset such as retry-attempt variants) and
are skipped with a single bounded `::notice::` (the absent count, the first three names, then
`and N more`) and never one line per name. `availability=available` means at least one requested
artifact was downloaded; `availability=unavailable` (exit 0) means none was
present. A present artifact whose download fails is a hard failure: the helper stops at the first
one, prints `download failed artifact=<name> exit=<n>`, exits non-zero (a downloader exit of 3 is
reported as 1 so it cannot be mistaken for absence), and writes no `availability` output.

`require-up-to-date` fetches the requested remote branch and fails unless its fetched tip is an
ancestor of `HEAD`. `gitleaks-directory-scan` builds and scans isolated staged-index and current
nonignored-working-tree mirrors with an explicit config; `--directory` selects the repository root.
`ast-grep-examples` runs native `ast-grep test`, then validates each scoped rule's `files:` and
`ignores:` examples with project `languageGlobs` replay from its root `--config`.
The shipped pack maps `**/*.ts`, `**/*.mts`, `**/*.cts`, and `**/*.tsx` to `Tsx` so one rule
covers script and JSX surfaces. Consumers must use the same `languageGlobs` and `language: Tsx`;
do not add `-tsx` companion YAML. Angle-bracket type assertions (`<T>value`) are not valid TSX.
`compareAstGrepCompanions` compares recursive `<name>.yml`/`.yaml` and `<name>-tsx` companion
rules across every YAML field, returns stable JSON-pointer differences, and rejects unsafe or
ambiguous rule paths. The supplied rule path and every ancestor must be physical directories; YAML
aliases and non-JSON tagged values are rejected before comparison. Callers own any explicit
normalization for language-specific differences.
`ast-grep-pack` prints JSON `{ rules, config }` for the shipped unconditional rule pack. Point a
consumer `sgconfig.yml` `ruleDirs` at `rules` and keep product-specific YAML locally.
`gha-workspace-policy` checks tracked workflow and composite-action files in the current repository;
pass `--root`, `--workflow-directory`, or `--action-directory` for consumer-owned layouts.

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
need `agent-blackboard@^0.6.0`. Snapshot cleanup accepts only package-generated temporary paths.
`appendJournal` and the journal CLI now require explicit mode, stable source-event identity, work
outcome, feedback coverage, and exact repositories. This is a breaking pre-1.0 API change; adopt the
shared contract before upgrading consumers. `appendJournal` reads a bounded UTF-8 note and delegates
to `writeFeedback`, returning delivered or pending state rather than a success-shaped message. The CLI accepts one or more
`--repository owner/name` flags; it records the entry's exact repositories and updates the session's
cumulative repository list before appending.
Programmatic callers launched from a different workspace directory pass their own module URL as
`dependencies: { resolveFrom: import.meta.url }`; the CLI defaults to the current package context.
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

## Sourceable Bash libraries

`scripts/worktree/git-worktrees.sh` is included in the published package. Source it to parse
`git worktree list --porcelain` with `git_worktree_*` helpers. Its
`git_worktree_canonical_path_hash <path>` helper resolves the physical path and prints a stable
`d` plus the first 12 lowercase hexadecimal characters of its SHA-256 digest.

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
  inspectHarnessEnvironment,
  selectHarnessSession,
} from 'vouchington-tooling/agent-harness-identity'
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
import {
  extractResponseContracts,
  validateResponseContract,
} from 'vouchington-tooling/contract-schema'
import {
  buildFixtureSchemaLock,
  validateFixtureContracts,
  writeGeneratedFiles,
} from 'vouchington-tooling/api-fixtures'
import { discoverAppRouteCtxContractsV1 } from 'vouchington-tooling/api-contract-discovery'
import { decide, deriveRetryAttempt } from 'vouchington-tooling/transient-retry'
import { parseCsvRows, streamCsvRows } from 'vouchington-tooling/csv'
import {
  extractLooseMarkdownTableRows,
  extractMarkdownTables,
  markdownSectionBetweenHeadings,
  parseGfmMarkdown,
  parseMarkdownTables,
} from 'vouchington-tooling/markdown'
import { readResponseBody } from 'vouchington-tooling/http-body'
import { runAstGrepRule } from 'vouchington-tooling/ast-grep-rule'
import { parseReviewPayload, remapReviewComments } from 'vouchington-tooling/gha-review-payload'
import { postReviewWithTokenFromEnv, runPostReview } from 'vouchington-tooling/gha-post-review'
import { postClaudeReviewFromEnv } from 'vouchington-tooling/gha-claude-post-review'
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
import {
  collectPnpmLicenseReport,
  evaluatePnpmLicenseReport,
} from 'vouchington-tooling/dependency-license-policy'
import { checkGhaWorkspacePolicy } from 'vouchington-tooling/gha-workspace-policy'
import { requireUpToDate } from 'vouchington-tooling/require-up-to-date'
import { runGitleaksDirectoryScan } from 'vouchington-tooling/gitleaks-directory-scan'
import { runAstGrepExamples } from 'vouchington-tooling/ast-grep-examples'
import { astGrepPackPaths } from 'vouchington-tooling/ast-grep-pack'
import { validateNugetUpdate } from 'vouchington-tooling/nuget-central-version'
import { normalizeSwiftSource } from 'vouchington-tooling/swift-semantic-equal'
import { parseUniqueSwiftBinaryTargetChecksum } from 'vouchington-tooling/swift-source-offset'
import { validateResolvedPinDelta } from 'vouchington-tooling/swift-resolved-pin-delta'
import {
  createForkLeakDetector,
  createVitestWorkerExitDiagnosticsReporter,
  formatDiagnosticReportSummaries,
  readDiagnosticReportSummaries,
  registerForkExitSentinel,
} from 'vouchington-tooling/vitest-diagnostics'
import { runRetrospectiveTranscript } from 'vouchington-tooling/retrospective-transcript'
import { appendJournal, probeBlackboard } from 'vouchington-tooling/agent-blackboard'
import { buildSessionFrictionReport, recordFriction } from 'vouchington-tooling/session-friction'
import { GITHUB_BODY_MAX_CHARACTERS, validateGitHubBodyLength } from 'vouchington-tooling'
import { createPullRequest, processDiffCommand, runGh, runGit } from 'vouchington-tooling/gh-cli'
import {
  shellScriptViolations,
  workflowYamlViolations,
} from 'vouchington-tooling/gh-api-shell-quoting'
```

`processDiffCommand` runs a caller-supplied `git diff` or `gh pr diff` executable and argv without
a shell, emitting complete unified-diff file blocks without accumulating the whole patch. It keeps
at most one file block (which can itself be large), preserves preambles and line content, and drains
a bounded stderr tail for typed command failures. Blocks are provisional until the returned promise
resolves: callers must discard accumulated results if the command later exits nonzero or is signaled.

```ts
let changedFileCount = 0
await processDiffCommand({ executable: 'git', args: ['diff', 'origin/main...HEAD'] }, async () => {
  changedFileCount += 1
})
// Use changedFileCount only after processDiffCommand resolves.
```

This breaking minor removes `getDiffAgainstBase`; migrate callers to `processDiffCommand` and pass
the command they need to run.

`checkSccComplexity` keeps its single repository-wide scan when `scopes` is omitted. Consumers
that need separately ratcheted areas may provide named scopes with positional `includePaths`; SCC
runs once per scope and reports the scope in each diagnostic. Parse a consumer-owned JSON baseline
with `parseSccComplexityBaseline` and pass it as `baseline`. Baselines are versioned, record the
maximum permitted complexity for each `{ scope, file }`, suppress only values at or below that
ceiling, and reject malformed, duplicate, untracked, stale, or out-of-scope entries.

`shellScriptViolations`/`workflowYamlViolations` flag a `gh api` call whose argument carries an
unquoted `?` or `&`: an unquoted `&` silently backgrounds the command and truncates the query
(the call still exits 0), and an unquoted `?` fails loudly under zsh glob-nomatch but passes
through unexpanded under bash. `workflowYamlViolations` decodes quoted and folded YAML `run:`
scalars before scanning, so a hazard hidden by YAML's own quote-stripping is still caught; it
throws on a `run:` value that is a YAML alias or a multiline PLAIN scalar, shapes it cannot yet
scan safely. Both functions scan already-in-scope source text — deciding which files count as a
shell script or a workflow/action YAML file is left to the caller.

`validateGitHubBodyLength` measures an issue or pull-request body against GitHub's 65,536 Unicode
code-point limit without altering it. Its result includes the UTF-8 byte count for diagnostics; that
byte count is not a validation limit.

`vouchington-tooling/markdown` parses GFM into standard mdast/unist nodes, provides pre-order
walking and typed searches, normalizes node text, and extracts positioned tables or heading-bounded
source sections. `parseMarkdownTables` preserves its compact `{ cells, line }[][]` compatibility
shape, including short table delimiters. `extractLooseMarkdownTableRows` is intentionally literal
recovery for malformed pipe rows; callers supply table positions to exclude and retain ownership of
their policy interpretation.

`parseMarkdownSections` returns visible root H2 sections, their exact original `content`,
`startOffset`/`endOffset` source ranges, heading line, and `hasVisibleContent`. Heading text is
normalized by collapsing whitespace and removing Markdown formatting/comments and collapsed text; matching remains
case-sensitive. Source offsets are JavaScript string offsets, so `source.slice(startOffset,
endOffset)` preserves Unicode and CRLF exactly. Sections end at the next visible root H2 or EOF;
fenced examples, quoted headings, and headings inside `<details>` do not create boundaries.

```ts
import { parseMarkdownSections, validateMarkdownSections } from 'vouchington-tooling/markdown'

const document = parseMarkdownSections(body)
const diagnostics = validateMarkdownSections(document, {
  requiredHeadings: ['Summary', 'Impact'],
})
const relatedIssues = document.sections.find((section) => section.heading === 'Related issues')
```

The caller owns required headings. Validation returns diagnostics with `code`, `message`, and
optional `heading`/`line`, for `missing-heading`, `duplicate-heading`, `empty-section`, or
`malformed-details`. Nonempty visible paragraphs, lists, and populated table bodies satisfy the
content check; comments, fenced/indented code, images, disclosure labels, and collapsed-only content
do not. The parser tracks balanced nested details/summary tags in GFM HTML nodes, accepting optional
summaries and quoted attributes; it is not a general HTML validator or sanitizer. It never rewrites
the input or infers semantic relevance, cost, schema conformance, or failure causes. The existing
`markdownSectionBetweenHeadings` API retains its original boundary behavior.

`hasUncheckedMarkdownTask` reports parsed unchecked GFM task items, ignoring code and non-task text.
`markdownLiteralSpans` returns source-backed `{ kind, position, value }` facts for fenced or indented
code, inline code, and raw HTML. `markdownHtmlFacts` distinguishes inline HTML from block HTML and
labels CommonMark block types 1–7; `markdownHtmlBlocks` selects block types 1, 6, and 7, retaining
the parser's source bounds, including type 1 blocks through their matching closer or end of input.
Positions use 1-indexed line/column coordinates and JavaScript string offsets, including CRLF and
Unicode source text. These APIs return facts rather than mdast nodes so callers can apply their own
content policy without binding it to parser internals.

```ts
import {
  hasUncheckedMarkdownTask,
  markdownHtmlBlocks,
  markdownLiteralSpans,
} from 'vouchington-tooling/markdown'

const hasOpenTask = hasUncheckedMarkdownTask(body)
const literalSpans = markdownLiteralSpans(body)
const blockHtml = markdownHtmlBlocks(body)
```

`markdownHtmlBlocks` reports CommonMark types 1, 6, and 7; inline tags do not appear in that result.
Use `markdownHtmlFacts` when inline/block classification and other CommonMark HTML block types are
also needed.

Machine-wide agent configuration now belongs to [vouchington-machines](https://github.com/vouchington/vouchington-machines/blob/main/docs/agent-config.md).
Use its `configure-agents.sh` and `diagnose-agents.sh`; project hooks and MCP configuration remain in their checkouts.

`agent-harness-identity` inspects the four harness environment signals without choosing a winner.
Callers supply their own precedence to `selectHarnessSession`, keeping product-specific identity
policy out of this package.

`checkWorkspaceGatesPolicy` rejects tracked test assertions that hard-code the exact version of a
dependency declared by a non-fixture package manifest. Assert dependency membership or placement,
or derive a configuration or documentation package spec from that manifest instead.

`dependency-license-policy` keeps legal policy in the consumer. `collectPnpmLicenseReport` returns
a promise. It creates an isolated, script-free temporary workspace, expands pnpm's supported
architectures to every `os`, `cpu`, and `libc` selector represented in the lockfile, drops every
`engines` constraint from the audit copy of the lockfile, and validates the JSON report. Dropping
`engines` keeps `pnpm fetch` from skipping optional packages that exclude the running Node.js;
pnpm 12's `fetch` ignores `force`, so their licenses would otherwise report as Unknown.
Packages are fetched into a dedicated owner-only store under the pnpm cache
(`dependency-license-audit-store`) so a later audit reuses content-addressed packages instead of
downloading every platform again, without writing those packages into the developer store.
Pass explicit denied SPDX IDs and prefixes, exact aliases, and justified allowlist scopes to
`evaluatePnpmLicenseReport`. Unknown, malformed, and custom SPDX references fail closed. Allowlist
scopes are either intentionally global or an exact package-name set; the library returns structured
violations and does not format CI-provider diagnostics.
When present, the repository `.npmrc` is copied into the owner-private temporary workspace so pnpm
can authenticate to the same registries. The workspace is removed when the audit finishes, when the
process receives SIGINT, SIGTERM, or SIGHUP, and on the next audit if the previous process died
first, including SIGKILL. Each workspace records its owner's PID so a later audit can delete
directories whose owner is gone.

`session-friction` is an opt-in capture and reporting library. Callers supply the session id,
absolute log directory, host-independent observation, and journal loader; it does not inspect host
environment variables, install hooks, or connect to a journal service by itself. Invoking
`recordFriction` touches the session log even when no event is classified, preserving the
difference between an observed clean session and missing evidence. Report markdown keeps backend
diagnostics separate from its paste-safe output. Capture stores at most 500 events per session and counts rejected captures in a fixed-size atomic
sidecar under the same session lock for either the event or byte limit, with visible `truncated`/`droppedCount` metadata. Saturated
capture reads only the bounded counter; reports also preserve historical overflow markers.
Interrupted or inconsistent counter updates make coverage unavailable. Malformed records also make the scan partial. It
truncates event detail to 1,000 characters, and consumes up to 500 entries from the journal loader
when building a report, stopping earlier when its aggregate 1 MB inspected-byte budget is reached.
Bounded journal scans that stop before exhaustion are reported as incomplete rather than clean.
Report liveness inherits the caller-supplied journal loader, which must bound its own I/O and yields.
Log reads are capped at 2 MB, journal Markdown at 10,000 bytes per entry,
and rendered audit fields at 120 escaped characters. Permission requests record requested outcomes; explicit result observations may record approved
or denied outcomes. A decision and simultaneous tool failure are both retained and counted in
the report. Escalation detail without a decision remains unknown. Localhost connection
refusal is an ambiguous failure and does not establish a sandbox cause. The supplied log directory must be dedicated
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
boundaries. Neutral review posting lives in `gha-post-review` and requires a caller-supplied GitHub
token. Claude App OIDC is an explicitly selected `gha-claude-post-review` adapter; the legacy
token-source router remains deprecated for one release line.

`vitest-diagnostics` reads Node diagnostic report JSON from a caller-selected directory. It sorts
filenames, tolerates partial files, returns only a bounded field allowlist, and never emits raw
native frame symbols. Both structured reads and text rendering have hard report-count limits.

`api-contract-discovery` is the version-one adapter for `app.route('/path').get/post/...` and
`ctx` response conventions. Pass a classic TypeScript `program` and its route `sourceFiles` to
`discoverAppRouteCtxContractsV1`. The result contains registered routes and response, request,
query, and header contracts. The caller owns program construction, route-file selection, and
generation. Pass `options.formatAliases` and `options.boundedArrayAlias` for application type
aliases; `options.onRouteError` enables lenient response and request extraction. The adapter
does not cache programs or depend on the caller's repository layout. OpenAPI document assembly
remains a separate `openapi-document` call.

`options.onAmbiguousAttribution` optionally emits facts for response calls lexically inside handler
functions registered to multiple routes, plus inline response calls within those handlers. Facts
are delivered after discovery succeeds, ordered by normalized source location; each callback gets
its own copy of the sorted route list. It recognizes direct property handlers on `const`
object-literal receivers, shorthand properties, immutable aliases, and inline handlers. Mutable
receivers whose properties may be reassigned, variable receivers without object-literal initializers,
and non-identifier receiver expressions fail closed for attribution.
Direct identifier assignment, identifier writes through array/object destructuring or loop targets,
identifier updates, and dot-property assignment or updates make that binding ineligible for attribution.
Computed receiver-property writes, `delete`, runtime reflection, and other indirect mutation are not
analyzed. Named helper calls are not followed transitively: for example, an
emission inside `emit(ctx)` is not attributed when a registered `shared(ctx)` handler calls
`emit(ctx)`. The callback does not change the discovered contract result.

Query contracts (`apiQuery`) carry requiredness. A top-level parameter descriptor type may include
`required: true` (inline or through an intersection such as `{ readonly required: true }`); the
extracted descriptor then has `required: true` and the OpenAPI parameter emits `required: true`,
otherwise `required: false`. `required` must be the literal `true`; `false`, `boolean`, optional, or
non-literal values fail as a malformed query parameter, as do `required` together with `default` and
`required` on `csv-array` `items`.

`discoverRequestValidationFacts({ program, sourceFiles, validators, factories, executedCallbacks })`
reports, per registered route (`METHOD:/template`), the route `kind` and `source`, every configured
validator call its handlers reach (`validatorSites`), every configured handler-factory call
(`factorySites`), and the raw request carriers the handlers read (`carrierReads`). It reports
facts only; which routes must validate and what counts as covered stay with the caller.

```ts
import { discoverRequestValidationFacts } from 'vouchington-tooling/api-contract-discovery'

const facts = discoverRequestValidationFacts({
  program,
  sourceFiles,
  validators: [
    {
      module: 'lib/validation.ts', // resolved declaration path suffix, or a package specifier
      exportName: 'validateInput',
      operationArgument: 1,
      carriers: { kind: 'input-object', argument: 2 }, // or { kind: 'fixed', carriers, optionCarriers }
    },
  ],
  factories: [
    {
      module: 'lib/factory.ts',
      exportName: 'createThingHandler',
      optionsArgument: 0,
      operationProperty: 'operation',
      carriers: ['path', 'body'],
    },
  ],
  executedCallbacks: [
    {
      module: 'lib/admit.ts',
      exportName: 'admitWork',
      argument: 0,
      properties: ['beforeCapacity'],
    },
  ],
})
```

A call matches only when its callee resolves, through aliases, re-exports and path mappings, to the
configured export of a declaration file matching `module` (`.d.ts`, `.d.mts` and `.d.cts` suffixes
are ignored when comparing, and the configured `module` may be written with or without a `.ts`,
`.mts`, `.cts`, `.js`, `.mjs` or `.cjs` extension, so `lib/validation.js` matches `lib/validation.ts`
and `lib/validation.d.ts`); import specifier text and same-named local functions never match.
Operation keys resolve through literals, `const`s (including imported ones), `as const`,
`satisfies`, helper parameters bound to static arguments, and, for factories, the option property
including spread `const` objects; anything else, including a name with no symbol, gives
`operation: null` with `unresolvedReason`. Each validated carrier reports `origins`, the request
carriers (`path`, `query`, `body`, `header`) its value derives from, traced through calls, followed
helper returns, branches, logical operands, spreads and earlier assignments; `unresolved` is set
when part of the value depends on an unbound parameter. An unconditional reassignment of the
identifier itself earlier in the same function body (not inside a branch, loop or `try`) replaces
the earlier origins, conditional reassignments merge, and property writes such as `x.limit = n`
always add; an assignment on a statically dead path (`if (false)`) is ignored. A destructured
local traces only the property or element it binds (`const { chosen } = pair`), resolved through
object and array literals, `const`s and followed helper returns (also awaited), and falls back to the
whole initializer when it cannot be selected (rest, computed key, spread, unknown source).
A destructured handler context parameter (`({ query, params, request }) => ...`) binds each member
to its carrier. A helper parameter that is reassigned is not trusted as the bound operation key:
only a lone unconditional reassignment is used, anything else gives `operation: null`.
Generator functions are not followed, because calling one does not run its body.
Fixed-carrier validators report the carrier itself as their origin.

An input-object validator's input is resolved through `const` objects and spreads with
last-write-wins semantics, like the factory option resolver. When it cannot be fully resolved (a
non-literal input, a spread of something that is not a resolvable `const` object, a cyclic spread,
or a computed property name), `carriers` lists what was found and the site sets
`unresolvedCarriers` to the reason, so a consumer must not treat `carriers` as complete. A `const`
object (input or factory options) with a property write before the use (`o.p = x`, `o[k] = x`,
`delete o.p`, `o.n++`, `Object.assign(o, ...)`) is unresolvable too, and a factory then reports
`operation: null`.

`conditional` is true under `if`/ternary branches, the right of `&&`/`||`/`??`, `switch` cases,
loop bodies, `catch` and `finally`. Handlers are walked into function declarations and `const`
function expressions in `sourceFiles`, and only through bindings that are never reassigned (`let`
and reassigned bindings are not trusted as handlers). A callback passed to a followed helper is
followed only when the helper runs it, and is conditional unless it is invoked directly from the
helper's own body outside any condition. Known limit: the invocations of an inline callback are
found only in the callback's own source file, so a callback passed to a helper declared in another
file (`withTx(ctx, async () => { validateInput(...) })`) is not walked. Inline callback properties of an `executedCallbacks` host,
written as identifiers or string literals, are walked as executed and take only the condition of
the call to the configured host, never how its implementation invokes them. Configured validator
and factory implementations are never entered, but their callee and arguments are still walked for
nested validator sites and reads; only reads that build a validator's input are left out, including
reads inside a followed helper that only prepares that input. Validators evaluated while a handler is
built (registration time) are not sites: only the walk of the handler reports validators. A handler a
helper returns under a runtime branch (`if (flag) return ctx => ...`) reports `conditional: true`. Factory
sites are reported for factory calls whose returned handler is a registration-time value (a route
registration argument, a module `const` used as one, or a helper-returned handler); a factory call
inside a handler body, such as a discarded `createThingHandler(options);`, is not a factory site.
A factory site is also found through a module `const` initialized by a factory call that a handler
calls (`const handler = createThingHandler({...})`, then `handler(ctx)`). Like validator sites,
`FactorySite.conditional` is true when the site is reached only under a condition, and a site
reached both ways is reported unconditional. A template-literal operation key folds to a string
when every substitution resolves (literals, `const`s, bound parameters); otherwise it is `null`.

Pass the `program` you already built: the function uses it as given and never builds its own.
Helpers are followed only within `sourceFiles`, so pass every file that declares a followed helper,
not just the route files; a helper declared elsewhere is not entered, which silently yields empty
`origins` rather than an error. An omitted optional or defaulted helper argument contributes no
origin and is not `unresolved`; an omitted required argument is `unresolved`. Per-call caches make
repeated helpers cheap, so a 700-route program completes in seconds once the program exists.

Each `carrierReads` entry has `access`: `key` for a static key (`ctx.query.limit`, destructured
names, a resolvable `ctx.query[name]`), `computed` for a non-static key (`ctx.query[name]`, a
computed destructuring key; `key: null`), and `whole` for the carrier used as a value
(`consume(ctx.query)`, `{ ...ctx.params }`, `return ctx.headers`, a rest element) or a body read
such as `ctx.request.json()` (`key: null`). A `const` alias of a carrier is not itself a read; its
uses are.

Version one recognizes literal-key `apiResponse`, `apiNoContent`, `apiOpenApiRawResponse`,
`apiRequest`, `apiRequestContract`, `apiNoRequestBody`, `apiQuery`, and `apiHeaders` markers inside
`app.route(...).get/post/put/patch/delete(...)` handlers. It also inspects unmarked `ctx.json`,
`ctx.pipeline`, `ctx.response.empty/buffer/xml`, `ctx.request.json/buffer`, `parseJsonBody`,
`ctx.setStatus`, and static `Content-Type` setters. The input source files and TypeScript checker
are the source representation; the adapter does not parse or discover a repository on its own.
Reading the handler context in another object's computed assignment key preserves its binding;
assignments or updates to the context itself, including side effects inside that key, still reject it.

Error-only 405 routes require a terminal throw on the handler's own context. Named handlers and
imported wrappers are followed through compiler declarations; conditional, caught, recursive,
fallthrough, and callback-only throws do not prove an error-only route. Empty `never[]` contracts
render as arrays with no items, and `Record<string, never>` renders as a closed empty object.
Standalone `never` and `any` remain unsupported contracts.

Caller-owned `apiSseFrame(key, { event, data })` markers expose literal event names and concrete
payloads from the frames actually written by a route, including callbacks passed to a handler
factory. SSE responses keep a string body schema and describe each payload under the media
type's `x-sse-events` map. Callback arguments require a concrete helper invocation path; ignored,
declaration-only, deferred, or rewritten callbacks fail closed. Callback options passed to a callee
without a concrete implementation also fail closed. Opaque callback escape checks include array and
tuple containers, nested object properties, and literal array spreads. Factory callbacks must execute
from the returned request handler; registration-time invocations do not prove a request emission. Compiler-resolved platform timers
and Promise executors supply invocation paths using the caller Program's actual standard-library
identities; shadowed, custom, or reassigned platform APIs do not. Mutation checks recognize Node's
compiler-declared `global` as well as `globalThis`. Fluent route registrations retain their method. Stable named
handlers and called local helpers are followed within their declaring source file. Ordinary response,
request, query, and header markers also require callback invocation before route attribution.
Broad names, unknown root payloads, executable unmarked frames through stream aliases, and
conditional or mutable-context status changes fail closed. Called SSE helpers inherit the proven
request context and its status at the invocation; mutually exclusive complete status branches retain
their separate responses. Explicit SSE statuses must be integers from 100 through 599.
Named Node PassThrough allocation proof is unavailable when a required stream constructor export
is replaced and canonical builtin ESM synchronization can update that binding. The actual Program's
cached export facts preserve metadata-only and unsynchronized writes; unknown module names or export
keys remain conservative.
Temporal exclusion requires a fresh Node PassThrough or a local, constructorless class without
heritage, ambient declarations, or decorators. The owner allocation must occur later in the same
function outside loops. Arguments that capture the owner or reference local callables or locally
created containers remain unknown, including callbacks retained for later invocation; generator
callbacks are never independent origins.
Metadata/member writes preserve callable binding capabilities. Timer exclusions require canonical,
unmodified platform proof; reflective replacement remains unknown. Opaque receiver identity requires
bounded fresh allocations, while unknown aliases remain unavailable.
Passed bindings and containers must remain unmodified for temporal exclusion; saved streams from
prior handler invocations remain unknown. Async or generator declarations cannot prove the object
returned by a synchronous factory invocation.
Script-global property replacement invalidates a factory binding. Fresh object properties require
object destructuring; deleting the selected owner property invalidates its allocation proof.
Writes through constant owner aliases also invalidate freshness through the existing receiver facts.
Unconditional blocks preserve the last proven status setter; conditional or foreign overwrites fail closed.
Indirect `setStatus.call`, `apply`, and `bind` forms fail closed instead of assuming status 200.
Ambiguous caller contexts fail closed. A raw stream failure invalidates all
selected SSE rows, including when only one protocol variant was requested. Object-literal wrapper
receivers fail closed for marked frames because their properties can mutate; raw wrapper writes
are matched to the original stream, including proven helper-parameter forwarding, overloaded helper
implementations, and literal bracket
methods. Compiler-resolved `Reflect.apply` calls use their actual receiver and payload.
Unsupported computed methods on that receiver fail closed. Byte-bearing
stream `end` calls and streams used as pipe destinations are raw emissions; empty terminal cleanup
is preserved. Replacing a selected stream's `write` implementation invalidates its frame evidence.
Binding a selected stream's `write` or `end` method fails closed because the bound
method can escape the proven emission path. A callback that captures
the route's stream or HTTP context and escapes to a callee without a concrete implementation can
write undocumented bytes, so the affected response contracts fail closed. Uncalled local callbacks,
dead branches, and implemented helpers that ignore their callback preserve the proven contracts.
Literal object/array arguments and constructor arguments retain selected-stream capabilities.
A concrete helper body outside the indexed source set is opaque to raw-write validation.
Cataloged SSE routes with only extracted non-SSE variants retain an unavailable event-stream
possibility alongside those responses until the extracted variants describe the stream.

Caller-owned `apiOpenApiHttpResponse(key, response)` markers bind a constant opaque response
carrying optional readonly `apiHttpResponseVariants` metadata. Each concrete union variant has
`status` and `bodyKind`; content variants also have `mediaType` and `body`. Discovery associates
the marked variable's status and body emissions without reading or replacing response bytes.
Feasible assignments, deletions, or updates to its body or status, including cast and constant
aliases, invalidate the selected contracts because their metadata no longer proves the dispatch.
A status setter must dominate each body emission, including separate branches; constant context
aliases are followed, assigned mutable context aliases and object-literal context wrappers fail closed,
and helper parameters must resolve to the registered caller's unchanged response context.
Helper-owned contracts also account for response emissions in their proven caller scopes.
Opaque callees receiving the canonical HTTP context or its response object invalidate its contract;
implemented helpers and consumed callbacks retain their proven dispatch behavior.
Factory callback proofs use the actual compiler Program to include static imports, reexports, and
literal dynamic-import consumers. Receiver obligations follow callback objects inside literal object
and array arguments with the selected caller bindings. A missing own callback is treated as absent
only when the complete Program preserves the global object prototype capability; prototype writes
or exposure to another call make that callback unavailable. Internal proofs without a Program source
list cannot establish this absence. Explicit own callbacks retain their concrete implementation.
Literal standard Node `require` consumers use the actual Program's source files and compiler options;
shadowed calls and modules outside that Program cannot establish a namespace identity. Concrete
helpers returning the Object prototype retain its capability when passed to another call.
Namespace identities follow actual imports, awaited literal dynamic imports through const aliases,
and the first fulfillment parameter of an inline literal-import promise callback;
asserted module types and pending import promises cannot substitute for executable provenance.
Loop assignment targets, class field initializers, and tagged-template substitutions preserve mutable
callback capabilities. Concrete omitted-argument defaults retain their forwarded parameter proof.
Inherited Object prototype methods stay unknown; constructors receiving the selected context,
including through a literal array spread, cannot
prove bounded status or body behavior. The discovery-owned consumer index is lazy and includes
TypeScript import-equals edges. Implemented callback bodies remain unavailable when they emit an otherwise
uncollected response body or status, expose a context through a literal argument, retain a mutable
context alias, or mutate a canonical response method. Conditions are inspected even when their
resolved return value skips a branch. Prototype capabilities reached through `getPrototypeOf`,
`__proto__`, or `constructor.prototype` also invalidate missing-own-property proofs.
Caller-bound defaults execute before the callback body when an argument is omitted or may be
undefined; proven provided values bypass those defaults. Context-bearing tagged substitutions remain
opaque escapes, while primitive context members preserve ordinary value semantics. A local `satisfies`
wrapper preserves the underlying factory value and existing provenance checks.
Destructured literal-import fulfillment parameters retain their actual exported mutation roots.
`Reflect.getPrototypeOf` exposes the same prototype capability as `Object.getPrototypeOf`.
Rest and executable `arguments` context aliases remain unavailable. Zero-argument literal callbacks
retain the existing branch-aware proof of their captured context. Returned context capabilities and
unaccounted emissions remain unavailable; concrete callees that ignore a supplied callback retain
their proof, and primitive member captures remain ordinary values.
Validated SSE frame and receiver evidence accounts for a pipeline only on its selected route and
exact stream invocation. A non-SSE sibling or a second unframed stream cannot reuse that evidence;
uniquely bound helper pipelines must match every executable invocation on the selected route.
The current pipeline proof requires a concrete factory-returned stream property; stream identities
that cannot pass the existing raw-write validation remain unavailable.
Feasible assignments or deletions of response methods through canonical context aliases invalidate
that dispatch evidence; dead, ignored, or unrelated method mutations preserve the contract.
Indirect response `call`, `apply`, and `bind` forms fail closed, including borrowed context receivers.
Compiler-resolved standard `Reflect.apply` uses its target and actual receiver to reject unrepresented
HTTP emissions; project implementations, unrelated contexts, and non-executed calls are preserved.
SSE frames and branded content variants reject body-forbidden 1xx, 204, 205, and 304 statuses.
Literal bracket response methods have the same emission checks as property methods. Unrelated raw emissions
remain unavailable. Separate branded response branches are checked together, and the nearest
proven status setter for each body must belong to that response. Observed content and bodyless
emissions must match the complete metadata union, including an empty response in the `else` branch
of a positive body check. Exact requested protocol rows are selected before
other payloads, media types, or statuses are validated. In lenient mode, incomplete marker evidence
keeps every selected sibling unavailable. Explicit 400 content variants also include the framework's
JSON error schema independently of their own media type. Explicit bodyless 400 metadata also
retains that framework JSON possibility and fails closed on the conflicting body kinds.

Fork diagnostics use a caller-selected `recordDirectory` in both the worker setup file and the
main-process reporter. Call `registerForkExitSentinel({ recordDirectory })` once per fork, then
update `setCurrentForkExitModule` and `setCurrentForkExitProject` around tests. Construct
`createVitestWorkerExitDiagnosticsReporter({ recordDirectory })` in the Vitest reporter list
before workers start. The reporter clears stale records at construction, preserves them across
watch reruns, and prints an attribution summary only for abnormal worker exits. The worker writes
a synchronous stderr line and one JSONL file per PID; a start record without an exit record
identifies a fork killed before its handler could run. `createForkLeakDetector` accepts tracked
resource names and warmup, threshold, and sustained-growth settings; the caller supplies each
checkpoint's resource counts. Use a caller-owned run directory: the reporter clears only regular
numeric PID `.jsonl` files there at construction and leaves the directory and other files alone.
Application metrics and CI artifact handling stay with the caller.

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

### Contract schema type queries

`getExportedTypeFacts` and `getCallRowTypeFacts` use an existing TypeScript `Program` from the
`contract-schema` subpath. Every request must also pass `typescript`, the same TypeScript compiler
API instance that created that `Program`. The source-file recognition check is a compatibility
guard, and callers remain responsible for pairing the same compiler instance; the query uses the
supplied API for compiler operations. Pass the exact `SourceFile.fileName`, an exported name or exact call
expression text, and only the property names and exported comparison types the consumer needs.
Facts include the displayed type, whether it is `any`, requested property displays, and requested
assignability booleans. `defaultTypeParameterIndex` selects an exported generic default;
direct defaults and direct references to preceding defaults are supported. Dependent composite
defaults and uninstantiated generic type declarations used as assignability targets fail with an
instruction to export and select a named instantiated type. Generic function values remain valid
compiler-backed comparison targets. Default lookup uses an outer class, interface, or type-alias
parameter list when present; otherwise it uses the first checker-visible call or construct
signature, never a hidden implementation or a later overload.
`rowSource: 'typeArgument'` selects a call's explicit type argument, while
`rowSource: 'awaitedRows'` selects `Awaited<ReturnType>.rows[number]`.
Call results are source ordered and include one-based line and column. An absent call returns an
empty array so the consumer can enforce its own cardinality; a selected call missing its requested
row type fails with a descriptive error. The package does not choose source files, expected
properties, or contract policy.

## Workflow skills outside plugins

The package ships a flat union of canonical workflow, testing, and database skills at
`skills/<skill>/SKILL.md`. This stable installed path supports agents that do not load Claude or
Codex plugins. The package build materializes plugin source trees without hand-copying skill content
and writes sorted schema-v1 provenance to `skills/manifest.json`.
Each manifest entry may declare its ordered `prerequisites`; ordinary Markdown links remain
cross-references and never cause additional skills to be linked.
Prerequisites ensure installation closure; they do not require eagerly reading every installed
skill. Follow the invoked skill's conditional instructions for the current task.

Canonical entrypoints direct agents to applicable local instructions and adapters before using
portable policy. Local `AGENTS.md` may name an adapter alias; an already-read canonical skill or
adapter is not loaded again. `linkSkill` still links files only: it does not load instructions,
resolve local aliases, or execute a workflow. Validate observed agent loading separately from
installation and packaged-resource checks.

Use `readSkillManifest(skillsRoot)` to discover installed skills or
`linkSkill({ name, sourceRoot, targetRoot })` to link one into an explicit consumer directory. The
CLI equivalent is `vouchington link-skill <name> --source-root <skills-dir> --target-root <dir>`.
When `sourceRoot` contains `manifest.json`, linking validates the packaged inventory and recursively
links declared prerequisites. Without a manifest, it links the conventional
`<sourceRoot>/<name>/SKILL.md` repository-local skill. It rejects missing or unsafe sources, paths
outside either root, and existing non-matching destinations.
`targetRoot` must already exist as a physical directory path: symlinked target roots or ancestors are
rejected.

## Validated feedback and delivery

Import `createFeedbackEnvelope`, `validateFeedbackEnvelope`, `writeFeedback`, `verifyFreshFeedback`,
`composeRetrospective`, `feedbackOutboxStatus`, and `flushFeedbackOutbox` from the existing
`vouchington-tooling/agent-blackboard` subpath. Consumers must run Node 24 or newer and install `agent-blackboard@^0.6.0` explicitly alongside
`vouchington-tooling`; the provider is not installed by this package. Missing provider installation
returns `client-unavailable`; missing or invalid connection configuration returns
`configuration-invalid`, separately from transport outages and authentication rejection.
The upstream `agent-blackboard` client still owns the
service protocol; this integration adds no provider schema or service. Supply consumer module
context through `dependencies.resolveFrom` or inject the client loader at the transport boundary.

The version-one envelope retains canonical `markdown` and storage `type: journal | retrospective`.
It requires exact canonical repositories, stable URL-safe `sourceEventId`, ISO timestamp, explicit
`workOutcome`, and `feedbackCoverage` with status, sources, and dropped count. Optional category is
context only. Retrospectives retain valid date and integer/string issue/PR references. Markdown is
capped at 12 KB and the envelope at 16 KB. Known credentials are redacted; authors remain responsible
for minimizing summaries and excluding raw logs, transcripts, environment dumps, and undisclosed
secrets. A bound violation fails visibly without clipping findings.

`writeFeedback({identity, envelope, mode, ...})` accepts an exact caller-owned session identity and
never manufactures native agent identities. Interactive mode requires an absolute outbox
directory. Ancestor ownership and permissions are not checked; existing directory and record modes
are accepted. New directories and files default to `0700` and `0600`. The outbox itself must be a
real directory, and records must be regular files. The writer persists before transport with atomic
rename, file/directory fsync, and a stable record path. The outbox holds at most 128 records and 2 MB. Saturation,
corruption, or persistence failure blocks capture and preserves unsent records. Delivered records
are removed only after matching readback. Pending state includes count and a safe diagnostic;
interactive CLI exit zero means durable retention, and callers must inspect the printed status to
know whether delivery was acknowledged. Autonomous errors and unpersisted writes fail nonzero.
Identity, content, and archived-session conflicts fail in either mode while preserving the unsent
record; they are not reported as transient pending delivery. Replay retains permanently conflicted
records and continues to deliver unrelated pending records; transient failures stop that replay.
Verified delivery retains its receipt when local cleanup fails, returning
`cleanupDiagnostic` with value `"outbox-cleanup-failed"`. A retained or crash-reappearing record is
safe to replay: an event is identified by session, `sourceEventId`, and content, and a duplicate that
differs only in `timestamp` is the same event, so it reports the stored record's `timestamp` and
receipt and the retained duplicate is removed.
Use `vouchington agent-blackboard journal flush --outbox-directory PATH` to replay unchanged pending
records after connectivity returns.

Autonomous mode prohibits the filesystem outbox. `verifyFreshFeedback` requires a fresh source-event
write plus readback of its own append receipt and rejects visible duplicate source records. This
is fresh online reporting evidence, not a distributed execution lease: eventually consistent
provider reads cannot establish source uniqueness. Trusted controllers
supply a unique new authorization-probe source ID, preserve their authoritative run/session
lineage, and atomically claim and revalidate the attempt before execution. Terminal writes keep work outcome separate from coverage and returned delivery state.
The delivered result includes a verified receipt with session ID, source-event ID and creation time.
Controllers require this online result together with atomically established attempt ownership
before execution.

Delivery is at least once. Replays pre-read matching source identity/content, accept equivalent
persistent duplicates, and reject conflicting reuse. Equality ignores object property order while
preserving array order. Each online operation has a 20-second deadline (`timeoutMs` can shorten it);
readback scans at most 10,000 records or 2 MB. The SDK does not expose cancellation for in-flight
requests, so a timed-out write can commit later. That never grants admission or a delivery receipt;
replay the identical envelope and source ID to verify its actual persistence.

`composeRetrospective` invokes the existing fact/transcript collectors with raw output disabled and
generates required sections and markers. Tool and architectural assessments preserve observation,
evidence, disposition and tracking reference. None-observed and unassessed states need a scoped
reason. Complete coverage is rejected when required sources are unavailable or capture is partial.
Typed collector reports expose availability independently of rendered text. Composition rejects
aggregate dropped counts below observed friction drops and retains larger caller aggregates without
double counting. Generated frontmatter carries validated `work_outcome` and `feedback_coverage`
for consumers to preserve or reject conflicting explicit overrides; trusted mode stays external.
Human top-five summaries do not authorize dropping additional durable findings.

The `## CI Failures` and `## Sandbox & Permission Audit` sections come from one optional audit
source; the two inputs are mutually exclusive and supplying both throws before any collector runs.
`friction: {directory, journalLoader, ...}` keeps reading the session-friction log together with the
journal and is unchanged. `journal: {journalLoader}` needs no friction directory or log: both
sections are assessed from the session's journal entries alone, and the report carries
`coverage.frictionStatus: 'journal-only'` (in place of `empty` or `events`) so the text states that
no log was observed. `feedbackCoverage.status: 'complete'` accepts either source. It is rejected
when neither is supplied (the error names the missing source), and a journal-only audit does not
count as assessed when the loader reports `not-found` (there is no log to establish that the session
was observed), throws, or is truncated by the scan bounds.

```ts
await composeRetrospective({ ...input, journal: { journalLoader } })
```

`journalLoader` is the session-friction `JournalLoader`; `JournalLoader`, `JournalLoadResult`,
`JournalEntry`, and `JournalAuditOptions` are exported as types from
`vouchington-tooling/agent-blackboard`. The `## CI Failures` block grammar and its three status
lines (`failures observed`, `none observed`, `unavailable (<reason>)`) are the same for both sources.
Journal-only sandbox and permission entries are journal Markdown entries that hold exactly one
block, escaped and length-bounded like CI failures, and other entries are ignored:

```markdown
- `sandbox-escalation` — git push — network write blocked
  - Outcome: requested | approved | denied | unknown
  - Evidence: permission prompt shown
  - Disposition: reran with approval
- `sandbox-failure` — node test — EPERM writing outside the worktree
  - Evidence: stderr showed EPERM
  - Disposition: moved output under TMPDIR
```

`ambiguous-failure` takes the same shape as `sandbox-failure`. The section reports
`Status: none observed` or `Status: events observed`, each followed by
`(journal entries only; no friction log observed)`; a truncated scan reports
`unavailable (journal scan incomplete)` with the entries read so far.

## Basic Auth exemption facts

`vouchington-tooling/basic-auth-doc-sync` extracts literal exemption collections from
TypeScript and route rows from Markdown. Callers configure declaration names and
runbook headings, then compare the returned data using their own route policy.
See the [API contract](docs/basic-auth-doc-sync.md).

## Publication writer inventory facts

`vouchington-tooling/post-publication-inventory` exports
`analyzePostPublicationWriterSource(source, fileName, options)`. It returns five booleans for an
approved capture-helper call, a capture opt-out, writes through a configured entity table,
generated relation writes, and eligibility-table writes. Consumers supply every module, symbol,
property, receiver, and table name through `PostPublicationWriterSourceOptions` and retain their
inventory schema, tracked files, exceptions, and diagnostics.

This preserves source-inventory heuristics, rather than proving runtime execution or SQL safety.
Capture imports/calls are name-based and order-independent; relation-variable appends are
order-sensitive. DML recognition examines literal/template text. Static table matching lowercases
the extracted name; dynamic literal table matching preserves case. Malformed TypeScript uses the
compiler's recovery tree. An argument-free append returns no relation fact.
Pass TypeScript source (`.ts` or `.mts`); the parser uses TypeScript mode even if the file name ends
in `.tsx`. Template expressions join their static fragments for DML matching, while DML prefixes
for generated-table facts come from templates rather than ordinary quoted strings. Dynamic
eligibility-table matching expects an unquoted literal immediately after the DML prefix and does
not recognize `DELETE FROM ONLY`.
