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
```

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
  generateSchemaSnapshot,
  renderSchemaMarkdown,
} from 'vouchington-tooling/pg-schema-snapshot'
import { buildOpenApiDocument, writeOpenApi } from 'vouchington-tooling/openapi-document'
import { decide, deriveRetryAttempt } from 'vouchington-tooling/transient-retry'
import { parseCsvRows, streamCsvRows } from 'vouchington-tooling/csv'
import { readResponseBody } from 'vouchington-tooling/http-body'
import { runAstGrepRule } from 'vouchington-tooling/ast-grep-rule'
import { parseReviewPayload, remapReviewComments } from 'vouchington-tooling/gha-review-payload'
import { nextPageUrlFromLinkHeader } from 'vouchington-tooling/http-link-pagination'
```

The artifact, review-payload, HTTP body, and pagination APIs validate untrusted inputs at their
boundaries. They do not include provider credentials, product policy, network transport, or
repository-specific package names; consumers supply those through their own adapters.
