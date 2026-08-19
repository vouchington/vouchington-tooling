# Development

pnpm workspace. Node >= 24. Two published packages live under `packages/`.

## Commands

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
pnpm run test:coverage
```

`oxlint` is type-aware and denies warnings. Source files are capped at 200 lines; tests at 500.

## Packages

- `vouchington-tooling` — CLI (`vouchington`) and subpath libraries
- `eslint-plugin-vouchington` — non-generic Vouchington lint rules

Generic ESLint/Oxlint rules belong in `jonathanong/no-mistakes`, not this repo.

## Extracted modules

Extracted code must contain no product identifiers. Repo-specific values are parameters, flags, or env vars (`HOST_LOCK_*`, not product-prefixed names).

Record the source SHA and path list in the commit body when copying from the product monorepo.

## Publishing

Do not publish from a laptop. The `Release` workflow is `workflow_dispatch` and will use npm trusted publishing once configured. There is no `NPM_TOKEN` on purpose.
