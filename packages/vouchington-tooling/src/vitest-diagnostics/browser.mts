// Browser-safe entry for Storybook and Vitest browser projects. Everything re-exported here must
// stay free of `node:*` imports and Node-only globals; `browser.test.mts` checks the import graph.
// Resource, fork-leak, reporter, and network-allowlist helpers need Node, so they live only in the
// Node entry (`vouchington-tooling/vitest-diagnostics`). The effective-timeout cap is a
// config-time Vite plugin and also stays out of the browser bundle.
export {
  checkAndRestoreFakeTimers,
  formatFakeTimerLeakDiagnostics,
} from './vitest-fake-timer-guard.mts'
export type { FakeTimerController } from './vitest-fake-timer-guard.mts'
