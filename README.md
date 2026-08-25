# vouchington-tooling

Public tooling extracted from the Vouchington product monorepo. Two npm packages, one CLI.

| Package                                                             | What it is                                    |
| ------------------------------------------------------------------- | --------------------------------------------- |
| [`vouchington-tooling`](./packages/vouchington-tooling)             | Libraries plus the `vouchington` CLI          |
| [`eslint-plugin-vouchington`](./packages/eslint-plugin-vouchington) | Non-generic Vouchington ESLint / Oxlint rules |

Both packages are published to npm. Releases go through the `Release` workflow (`workflow_dispatch`) using npm trusted publishing (OIDC). Do not publish from a laptop.

## Agent plugins

The repository also publishes the public [`security-triage`](./plugins/security-triage) and
[`vouchington-workflow`](./plugins/vouchington-workflow) agent plugins. `security-triage` has one
repository-neutral security-finding skill. `vouchington-workflow` provides reusable implementation,
commit, GitHub Actions, package-metadata, and static-analysis skill foundations. Both plugins use
one canonical `skills/` tree for Codex and Claude; consumer repositories add their local policy in
`AGENTS.md`, `CLAUDE.md`, or thin wrapper skills.

`security-triage` is intentionally repository-neutral: it analyzes findings and returns a versioned
handoff, while each consuming repository owns issue taxonomy and issue creation.

### Install

Codex:

```bash
codex plugin marketplace add vouchington/vouchington-tooling --ref main
codex plugin add security-triage@vouchington
codex plugin add vouchington-workflow@vouchington
```

Claude:

```bash
claude plugin marketplace add vouchington/vouchington-tooling --sparse .claude-plugin plugins
claude plugin install security-triage@vouchington
claude plugin install vouchington-workflow@vouchington
```

Grok:

```bash
grok plugin install vouchington/vouchington-tooling#plugins/security-triage
grok plugin install vouchington/vouchington-tooling#plugins/vouchington-workflow
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
```

The clone and symlink commands intentionally fail if either target already exists, preventing an
update from overwriting or nesting an existing local plugin.

Centralized Cursor marketplace publication is not part of this repository change.

## GitHub Actions

Pin by commit SHA. The public actions never take a free-text `prompt` input. Prompt text comes from
trusted files on `trusted_prompt_ref`. `extra_prompt` is rejected unless the calling repository is
private. There is no `@claude` mention workflow.

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
    payload_artifact_name: opencode
    openrouter_api_key: ${{ secrets.OPENROUTER_FREE_API_KEY }}
```

Or call the two-job reusable workflow:

```yaml
jobs:
  review:
    uses: vouchington/vouchington-tooling/.github/workflows/code-review.yml@<sha>
    with:
      pr_number: ${{ inputs.pr_number }}
      runs_on: '["self-hosted","Claude Code"]'
    secrets:
      claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

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
vouchington install-playwright-chromium-arm64
vouchington ghcr-package-retention example%2Fapi
vouchington nuget-central-version trusted.props candidate.props metadata.json out.props
vouchington swift-semantic-equal BASE HEAD App.swift
vouchington post-review
vouchington stage-review-payload optional|required <source> <destination>
```

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
```

`sql-ast` requires the optional dependency `@libpg-query/parser`. `sql-scanner` does not.
`dockerfile-parse` uses `dockerfile-ast`.

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
