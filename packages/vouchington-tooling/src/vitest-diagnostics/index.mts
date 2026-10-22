export {
  registerForkExitSentinel,
  setCurrentForkExitModule,
  setCurrentForkExitProject,
} from './vitest-fork-exit-sentinel.mts'
export type { ForkExitSentinelOptions } from './vitest-fork-exit-sentinel.mts'
export {
  clearForkExitRecords,
  formatForkExitSentinelSection,
  readForkExitRecords,
  summarizeForkExitRecords,
} from './vitest-fork-exit-records.mts'
export type { ForkExitSentinelRecord, ForkExitRecordSummary } from './vitest-fork-exit-records.mts'
export {
  createVitestWorkerExitDiagnosticsReporter,
  formatWorkerExitDiagnostics,
  isWorkerExitError,
} from './vitest-worker-exit-diagnostics-reporter.mts'
export {
  createForkLeakDetector,
  formatForkLeakDiagnostics,
  getForkLeakDetector,
  waitForResourceCloseCallbacks,
} from './vitest-fork-leak-detection.mts'
export {
  checkAndRestoreFakeTimers,
  formatFakeTimerLeakDiagnostics,
} from './vitest-fake-timer-guard.mts'
export type { FakeTimerController } from './vitest-fake-timer-guard.mts'
export {
  consumeTestNetworkAllowlistViolation,
  installTestNetworkAllowlist,
} from './vitest-network-allowlist.mts'
export type { TestNetworkAllowlistOptions } from './vitest-network-allowlist.mts'
export {
  getRegisteredPoolMetrics,
  getRegisteredPoolSocketHandles,
} from './vitest-fork-leak-diagnostics.mts'
export {
  FORK_LEAK_HANDSHAKE_MAX_TURNS,
  FORK_LEAK_HANDSHAKE_STABLE_OBSERVATIONS,
  formatActiveResources,
  formatProcessResources,
  formatResourceCounts,
  waitForForkLeakHandshakeSettle,
} from './vitest-fork-leak-handshake.mts'
export { countResourcesByType } from './vitest-process-resources.mts'
export { recordForkLeakCheckpoint } from './vitest-fork-leak-handshake-samples.mts'
export type { ForkLeakHandshakeSettlement } from './vitest-fork-leak-handshake.mts'
export type { PoolMetrics, PoolSocketHandles } from './vitest-fork-leak-handshake-samples.mts'
export type { ForkLeakDiagnosticsOptions } from './vitest-fork-leak-diagnostics.mts'
export type {
  ForkLeakDetector,
  ForkLeakDetectorOptions,
  ForkLeakVerdict,
} from './vitest-fork-leak-detection.mts'

export {
  DEFAULT_MAX_DIAGNOSTIC_REPORTS,
  DEFAULT_MAX_FORMATTED_DIAGNOSTIC_REPORTS,
  formatDiagnosticReportSummaries,
  HARD_MAX_DIAGNOSTIC_REPORTS,
  MAX_DIAGNOSTIC_REPORT_BYTES,
  HARD_MAX_DIAGNOSTIC_DIRECTORY_ENTRIES,
  readDiagnosticReportSummaries,
  summarizeDiagnosticReport,
} from './report-summary.mts'
export type { DiagnosticReportLimitOptions, DiagnosticReportSummary } from './report-summary.mts'
