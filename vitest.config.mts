import { globSync, readFileSync } from 'node:fs'

import { defineConfig } from 'vitest/config'

const TESTS = 'packages/*/src/**/*.test.mts'

// Reusing workers saves a fork per file, but a module mock or a module
// re-imported after vi.resetModules stays in the shared module registry for
// every later file in that worker, so those files keep their own.
const MODULE_MOCKING_TESTS = globSync(TESTS).filter((file) =>
  /\bvi\.(?:mock|doMock|resetModules)\b/.test(readFileSync(file, 'utf8')),
)

export default defineConfig({
  test: {
    fileParallelism: false,
    server: { deps: { inline: [/@vouchington\/worker-runtime/] } },
    projects: [
      {
        extends: true,
        test: {
          name: 'shared',
          include: [TESTS],
          exclude: MODULE_MOCKING_TESTS,
          isolate: false,
          setupFiles: ['./vitest.shared-reset.mts'],
        },
      },
      { extends: true, test: { name: 'isolated', include: MODULE_MOCKING_TESTS } },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.mts'],
      exclude: [
        'packages/*/src/**/*.test.mts',
        'packages/*/src/**/*.test-helpers.mts',
        'packages/*/src/index.mts',
        'packages/*/src/sql-ast/index.mts',
        'packages/*/src/gha-runtime-audit/index.mts',
        'packages/*/src/pnpm-install/index.mts',
        'packages/*/src/shared-context/index.mts',
        'packages/*/src/gha-artifacts-cleanup/index.mts',
        'packages/*/src/vitest-blob-manifest/index.mts',
        'packages/*/src/pg-schema-snapshot/index.mts',
        'packages/*/src/postgres-test-faults/index.mts',
        'packages/*/src/request-query-profile/index.mts',
        'packages/*/src/request-query-profile/types.mts',
        'packages/*/src/openapi-document/index.mts',
        'packages/*/src/contract-schema/index.mts',
        'packages/*/src/contract-schema/types.mts',
        'packages/*/src/contract-schema/typescript-api.mts',
        'packages/*/src/api-fixtures/index.mts',
        'packages/*/src/coverage-transport/index.mts',
        'packages/*/src/pnpm-deploy/index.mts',
        'packages/*/src/dockerfile-parse/index.mts',
        'packages/*/src/workspace-gates/index.mts',
        'packages/*/src/workspace-gates/index.mts',
        'packages/*/src/gh-cli/index.mts',
        'packages/*/src/agent-issue-labels/index.mts',
        'packages/*/src/fresh-base/index.mts',
        'packages/*/src/pull-request-diff/index.mts',
        'packages/*/src/**/*-types.mts',
        'packages/*/src/scc-complexity/repo-cli.mts',
        'packages/*/src/pg-schema-snapshot/types.mts',
      ],
      thresholds: {
        'packages/vouchington-tooling/src/worker-query-profile/**': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        lines: 99,
        functions: 99,
        statements: 99,
        // AST walkers have defensive parse-tree continues that are not
        // worth a fake parser for every subtype.
        branches: 95,
      },
    },
  },
})
