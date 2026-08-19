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
```

## Packages

### `vouchington-tooling`

Subpath imports keep consumers off modules they do not need. Heavy parsers are optional:

```ts
import { isRunnerReservedPort, runnerPortPolicy } from 'vouchington-tooling/runner-port-policy'
import { initSqlAst, lineOfUtf8ByteOffset } from 'vouchington-tooling/sql-ast'
```

`sql-ast` requires the optional dependency `@libpg-query/parser`.

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
