# vouchington-tooling

Public tooling extracted from the Vouchington product monorepo. Two npm packages, one CLI.

| Package                                                             | What it is                                    |
| ------------------------------------------------------------------- | --------------------------------------------- |
| [`vouchington-tooling`](./packages/vouchington-tooling)             | Libraries plus the `vouchington` CLI          |
| [`eslint-plugin-vouchington`](./packages/eslint-plugin-vouchington) | Non-generic Vouchington ESLint / Oxlint rules |

Both packages are published to npm. Releases go through the `Release` workflow (`workflow_dispatch`) using npm trusted publishing (OIDC). Do not publish from a laptop.

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
import { nextPageUrlFromLinkHeader } from 'vouchington-tooling/http-link-pagination'
import { cmdUpload, mintPresignedControl } from 'vouchington-tooling/coverage-transport'
```

`sql-ast` requires the optional dependency `@libpg-query/parser`. `sql-scanner` does not.

Security-sensitive helpers are provider-neutral and fail closed on malformed artifacts, payloads,
response bodies, and pagination links. Product policy, credentials, and network transport remain in
the consuming repository.

### `eslint-plugin-vouchington`

House-style rules shared across Vouchington repositories. Rule routing:

1. **Generic** (any TypeScript/JavaScript repo) → [`eslint-plugin-no-mistakes`](https://github.com/jonathanong/no-mistakes)
2. **Vouchington convention** with no product nouns → this plugin
3. **Single-repo product coupling** → stays in the product monorepo

The plugin ships with no rules until a candidate passes (2).

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
