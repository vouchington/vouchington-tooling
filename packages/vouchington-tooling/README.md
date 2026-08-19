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
import { writeVitestBlobManifest } from 'vouchington-tooling/vitest-blob-manifest'
import { runInstallLifecycle } from 'vouchington-tooling/pnpm-install'
import { buildSharedContext, runNamedChecks } from 'vouchington-tooling/shared-context'
```
