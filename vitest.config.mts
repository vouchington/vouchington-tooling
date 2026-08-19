import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.mts'],
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
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        // AST walkers have defensive parse-tree continues that are not
        // worth a fake parser for every subtype.
        branches: 95,
      },
    },
  },
})
