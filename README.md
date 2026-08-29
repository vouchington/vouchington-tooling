# vouchington-tooling

Public tooling extracted from the Vouchington product monorepo. Two npm packages, one CLI.

| Package                                                             | What it is                                    |
| ------------------------------------------------------------------- | --------------------------------------------- |
| [`vouchington-tooling`](./packages/vouchington-tooling)             | Libraries plus the `vouchington` CLI          |
| [`eslint-plugin-vouchington`](./packages/eslint-plugin-vouchington) | Non-generic Vouchington ESLint / Oxlint rules |

Both packages are published to npm. Releases go through the `Release` workflow (`workflow_dispatch`) using npm trusted publishing (OIDC). Do not publish from a laptop.

## Agent plugins

The repository also publishes the public [`security-triage`](./plugins/security-triage),
[`vouchington-workflow`](./plugins/vouchington-workflow),
[`vouchington-testing`](./plugins/vouchington-testing), and
[`vouchington-database`](./plugins/vouchington-database) agent plugins. `security-triage` has one
repository-neutral security-finding skill. `vouchington-workflow` provides reusable implementation,
commit, GitHub Actions, package-metadata, static-analysis, planning, issue-management,
blackboard journaling, retrospective and follow-up review, CI-log review, and
pull-request-description skills. All plugins use one canonical
`skills/` tree for Codex and Claude; consumer repositories add their local mechanics and policy in
`AGENTS.md`, `CLAUDE.md`, or thin wrapper skills. The portable issue workflow verifies live
collaborator authority before creation, routes denied external work to a verified consumer tracker,
uses existing labels without extra approval, and requires explicit approval before creating labels.
Consumers still own repository defaults, taxonomy definitions, templates, and stricter policy.

`security-triage` is intentionally repository-neutral: it analyzes findings and returns a versioned
handoff, while each consuming repository owns issue taxonomy and issue creation.

`vouchington-testing` supplies shared test-authoring guidance plus Vitest, backend, Next.js,
Playwright, Storybook, Swift, and .NET specializations. `vouchington-database` supplies PostgreSQL
performance and UUIDv7 partitioning guidance. Consumer wrappers own runner configuration, fixtures,
database policy, and commands.

### Install

Codex:

```bash
codex plugin marketplace add vouchington/vouchington-tooling --ref main
codex plugin add security-triage@vouchington
codex plugin add vouchington-workflow@vouchington
codex plugin add vouchington-testing@vouchington
codex plugin add vouchington-database@vouchington
```

Claude:

```bash
claude plugin marketplace add vouchington/vouchington-tooling --sparse .claude-plugin plugins
claude plugin install security-triage@vouchington
claude plugin install vouchington-workflow@vouchington
claude plugin install vouchington-testing@vouchington
claude plugin install vouchington-database@vouchington
```

Grok:

```bash
grok plugin install vouchington/vouchington-tooling#plugins/security-triage
grok plugin install vouchington/vouchington-tooling#plugins/vouchington-workflow
grok plugin install vouchington/vouchington-tooling#plugins/vouchington-testing
grok plugin install vouchington/vouchington-tooling#plugins/vouchington-database
```

Other Claude-compatible clients that support the same direct-install syntax can select either
plugin directory.

Cursor loads local Agent Plugins. Clone the source once and link its plugin directory into Cursor's
local plugin root, then restart Cursor or reload the window:

```bash
mkdir -p ~/.cursor/plugins/sources ~/.cursor/plugins/local
git clone --depth 1 https://github.com/vouchington/vouchington-tooling.git \
  ~/.cursor/plugins/sources/vouchington-tooling
ln -s ~/.cursor/plugins/sources/vouchington-tooling/plugins/vouchington-workflow \
  ~/.cursor/plugins/local/vouchington-workflow
ln -s ~/.cursor/plugins/sources/vouchington-tooling/plugins/security-triage \
  ~/.cursor/plugins/local/security-triage
ln -s ~/.cursor/plugins/sources/vouchington-tooling/plugins/vouchington-testing \
  ~/.cursor/plugins/local/vouchington-testing
ln -s ~/.cursor/plugins/sources/vouchington-tooling/plugins/vouchington-database \
  ~/.cursor/plugins/local/vouchington-database
```

The clone and symlink commands intentionally fail if either target already exists, preventing an
update from overwriting or nesting an existing local plugin.

Centralized Cursor marketplace publication is not part of this repository change.

## GitHub Actions

Pin by commit SHA. The public actions never take a free-text `prompt` input. Prompt text comes from
trusted files on `trusted_prompt_ref`. `extra_prompt` is rejected unless the calling repository is
private. This repository's automatic review pins its prompts to
[`docs/prompts/code-review.md`](./docs/prompts/code-review.md) and
[`docs/prompts/code-review-inline-comments.md`](./docs/prompts/code-review-inline-comments.md);
the public actions retain the caller-owned `.agents/skills/agent-workflow/code-review-prompt.md`
default for compatibility.
The payload contract requires every finding to be an inline comment so repository rules can require
thread resolution. There is no `@claude` mention workflow.

```yaml
- uses: vouchington/vouchington-tooling/.github/actions/code-review@<sha>
  with:
    pr_number: ${{ inputs.pr_number }}
    trusted_prompt_ref: ${{ github.sha }}
    claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}

- uses: vouchington/vouchington-tooling/.github/actions/code-review-poster@<sha>
  with:
    pr_number: ${{ inputs.pr_number }}
    artifact_id: ${{ steps.review.outputs.payload_artifact_id }}

- uses: vouchington/vouchington-tooling/.github/actions/opencode-code-review@<sha>
  with:
    pr_number: ${{ inputs.pr_number }}
    trusted_prompt_ref: ${{ github.sha }}
    model: openrouter/stealth/ox-alpha
    # Optional: OpenCode runtime cap in seconds (1-1500; default: 1200), plus a 30-second termination grace.
    timeout_seconds: '1200'
    payload_artifact_name: opencode
    openrouter_api_key: ${{ secrets.OPENROUTER_FREE_API_KEY }}

- uses: vouchington/vouchington-tooling/.github/actions/dependabot-automerge@<sha>
  with:
    automerge_token: ${{ secrets.DEPENDABOT_AUTOMERGE_TOKEN }}
    # Optional: JSON rules that require manual merge for an ecosystem/directory.
    manual_update_rules: '[{"packageEcosystem":"nuget","directory":"/native"}]'
```

`dependabot-automerge` fetches trusted Dependabot metadata with the workflow token, only enables
auto-merge for patch updates at any version and minor updates with a stable target on major 1 or later, and rechecks the live bot-owned same-repository
branch before using the dedicated token to enable eligible auto-merge or disable stale auto-merge.
The `automerge_token` must be a dedicated token because a
`GITHUB_TOKEN` merge does not trigger downstream workflows. It must be stored specifically as a
repository Dependabot secret, or as an organization Dependabot secret selected for every consumer
repository—not only as an Actions secret—and needs Contents and Pull requests read/write permission. Mutation failures intentionally fail the job
so a broken or underprivileged token cannot look like successful automation. Both manual-rule fields
must exactly match `dependabot/fetch-metadata`; ecosystems are lowercase and directories include the leading slash. Use the action only from a trusted
`pull_request_target` workflow that checks out the exact base SHA with credentials disabled; never
check out or execute pull-request code. Include `converted_to_draft` and `edited` event types so the
action can disable stale auto-merge after draft conversion or a base-branch retarget.

The action never submits or requires an approval review. Branch-protection required checks remain
the merge gate; consumers should not add a separate workflow that auto-approves Dependabot PRs.

Or call the two-job reusable workflow:

```yaml
jobs:
  review:
    uses: vouchington/vouchington-tooling/.github/workflows/code-review.yml@<sha>
    with:
      pr_number: ${{ inputs.pr_number }}
      expected_head_sha: ${{ inputs.expected_head_sha }}
      expected_base_sha: ${{ inputs.expected_base_sha }}
      trusted_prompt_ref: ${{ inputs.expected_base_sha }}
      runs_on: '["self-hosted","Claude Code"]'
    secrets:
      claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

When an orchestrator selects an exact pull request revision, it must pass both expected SHAs
together and set `trusted_prompt_ref` to `expected_base_sha`. The reusable workflow rejects a
changed head or base before the agent starts and requires the trusted prompt ref to match that base.
The agent checkout is pinned to the selected head. At the write boundary, the poster verifies both
selected refs and binds the review commit ID to the selected head SHA. A validation failure exits
before the review agent runs or before a review is posted.

This repository's automatic final review runs OpenCode through OpenRouter and OpenCode Zen in
parallel only after the exact pull request head has a successful `tests` fan-in. A trusted
default-branch `pull_request_target` workflow creates the native
`Final Code Review / Code Reviewed` job for every pull request head. Forks, Dependabot, and Renovate
never receive review secrets or a provider checkout; that same native job passes only after their
exact-head tests succeed.

The setup expects these organization Actions variables and fails when any is missing or malformed:

- `CLAUDE_CODE_REVIEW_ENABLED` (`true` or `false`)
- `CLAUDE_CODE_REVIEW_MODEL` (`haiku`, `sonnet`, or `opus`)
- `CLAUDE_CODE_REVIEW_EFFORT` (`low`, `medium`, `high`, `xhigh`, or `max`)
- `OPENCODE_CODE_REVIEW_ENABLED` (`true` or `false`)
- `OPENCODE_CODE_REVIEW_MODEL`
- `OPENCODE_ZEN_CODE_REVIEW_ENABLED` (`true` or `false`)
- `OPENCODE_ZEN_CODE_REVIEW_MODEL`

It also expects `OPENROUTER_FREE_API_KEY` and `OPENCODE_FREE_API_KEY` as organization Actions
secrets, plus `CLAUDE_CODE_OAUTH_TOKEN` when Claude review is enabled. Provider execution and
review-comment posting are advisory: failures are reported as warnings but do not fail
`Code Reviewed`. Workflow selection, settings, exact-test provenance, live-head validation, and
adding `final-code-review:complete` remain fail-closed. Label mutations need both `issues: write`
and `pull-requests: write` (`issues: write` alone 403s PR labels). There is no PAT router or
synthetic check publisher for the required context. Claude `workflow_call` `required_review` is a
string so `workflow_dispatch` input leaves remain strings.

## CLI

```bash
vouchington --help
vouchington --version
vouchington runner-port-policy
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
vouchington gha-artifacts-cleanup run --run-id 123 --keep-pattern 'plan-*'
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
vouchington install-playwright-chromium-arm64
vouchington ghcr-package-retention example%2Fapi
vouchington harness-admission-lane 4
vouchington harness-assert-gates HARNESS_DISPATCH_ENABLED HARNESS_SHEPHERD_ENABLED
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

## Packages

### `vouchington-tooling`

Subpath imports keep consumers off modules they do not need. Heavy parsers are optional:

```ts
import { isRunnerReservedPort, runnerPortPolicy } from 'vouchington-tooling/runner-port-policy'
import { initSqlAst, extractCreateTableMetadata } from 'vouchington-tooling/sql-ast'
import { splitSqlStatements } from 'vouchington-tooling/sql-scanner'
import { auditCiJobRuntime } from 'vouchington-tooling/gha-runtime-audit'
import { writeVitestBlobManifest } from 'vouchington-tooling/vitest-blob-manifest'
import { prepareVitestReports } from 'vouchington-tooling/vitest-reports'
import { runInstallLifecycle, validateReleaseAgePolicy } from 'vouchington-tooling/pnpm-install'
import {
  buildSharedContext,
  installFakeGit,
  runNamedChecks,
} from 'vouchington-tooling/shared-context'
import { writeSelectedFilesOutput } from 'vouchington-tooling/gha-selected-files'
import { createArtifactClassifier, runCleanup } from 'vouchington-tooling/gha-artifacts-cleanup'
import { validateOptionalHttpOrigin } from 'vouchington-tooling/http-origin'
import { boundPendingLine, splitCompleteLines } from 'vouchington-tooling/process-line-buffer'
import { decide } from 'vouchington-tooling/transient-retry'
import { parseCsvRows } from 'vouchington-tooling/csv'
import { readResponseBody } from 'vouchington-tooling/http-body'
import { parseReviewPayload } from 'vouchington-tooling/gha-review-payload'
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
import { isSwiftCodeOffset } from 'vouchington-tooling/swift-source-offset'
import { validateResolvedPinDelta } from 'vouchington-tooling/swift-resolved-pin-delta'
import { runRetrospectiveTranscript } from 'vouchington-tooling/retrospective-transcript'
import { buildSessionFrictionReport, recordFriction } from 'vouchington-tooling/session-friction'
```

`sql-ast` requires the optional dependency `@libpg-query/parser`. `sql-scanner` does not.
`dockerfile-parse` uses `dockerfile-ast`.

`session-friction` remains dormant until a caller explicitly supplies a session id, absolute log
directory, hook observation, and journal loader. Host payload parsing, hook installation, session
discovery, and journal transport stay with the consuming repository. Capture stores at most 500
events per session, truncates event detail to 1,000 characters, and consumes up to 500 entries
from the journal loader when building a report, stopping earlier when its aggregate 1 MB
inspected-byte budget is reached. Log reads are capped at 2 MB, journal Markdown at
10,000 bytes per entry, and newly created evidence directories and files are owner-only. Recording
and report construction synchronously access the evidence log and may wait up to one second for a
contended per-session file lock before failing explicitly. Evidence-directory validation requires
POSIX ownership and mode checks (Linux and macOS), so session-friction throws on Windows.
Command-prefix normalization attempts limited redaction of obvious credential patterns but is not
a secret scrubber; callers must not include credentials in captured commands.

Security-sensitive helpers are provider-neutral and fail closed on malformed artifacts, payloads,
response bodies, and pagination links. Product policy, credentials, and network transport remain in
the consuming repository.

### `eslint-plugin-vouchington`

House-style rules shared across Vouchington repositories. Rule routing:

1. **Generic** (any TypeScript/JavaScript repo) → [`eslint-plugin-no-mistakes`](https://github.com/jonathanong/no-mistakes)
2. **Vouchington convention** with no product nouns → this plugin
3. **Single-repo product coupling** → stays in the product monorepo

The plugin currently ships `postgres-cursor-call-contract`, `banned-member-read`, and `factory-owner-location`. Callers pass module specifiers, members, factories, and owner files; product paths stay in the consuming repository.

## Development

Requires Node 24+ and pnpm 11+.

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
```

Run the local CLI after a build:

```bash
node packages/vouchington-tooling/dist/cli/index.mjs --help
```
