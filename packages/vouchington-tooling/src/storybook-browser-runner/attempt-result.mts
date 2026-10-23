import type { BrowserSessionResult } from '../browser-session-runner/index.mts'
import type { StorybookBrowserBootstrapSnapshot } from './bootstrap-telemetry.mts'
import type { OutputObserverSnapshot } from './observer-state.mts'
import type { WatchdogOutcome } from './watchdog.mts'

export type AttemptResult = {
  bootstrap: StorybookBrowserBootstrapSnapshot
  budgetExpired: boolean
  code: number
  durationMs: number
  exitCode: number | null
  firstTestOutputAtMs: number | null
  hung: boolean
  isStall: boolean
  lastOutputAgeMs: number
  newOptimizeDeps: string[]
  optimizerReadyAtMs: number | null
  optimizerReloadFromNewDeps: boolean
  resultFileDetectedAtMs: number | null
  retryable: boolean
  runnerMissing: boolean
  semanticProgress: boolean
  semanticStall: boolean
  signal: NodeJS.Signals | null
  viteFetchFailure: boolean
  viteReady: boolean
}

export type AttemptFacts = {
  bootstrap: StorybookBrowserBootstrapSnapshot
  finishedAt: number
  observed: OutputObserverSnapshot
  outcome: WatchdogOutcome
  spawnFailed: boolean
  startedAt: number
}

const relativeTo = (startedAt: number, at: number | null) => (at == null ? null : at - startedAt)

/** Maps the session exit plus the observed output to the attempt result and its retry rule. */
export function buildAttemptResult(
  session: Pick<BrowserSessionResult, 'exit' | 'reason'>,
  facts: AttemptFacts,
): AttemptResult {
  const { bootstrap, finishedAt, observed, outcome, spawnFailed, startedAt } = facts
  const optimizerReloadFromNewDeps = observed.sawNewOptimizeDeps && observed.sawOptimizerReload
  const runnerMissing =
    observed.sawAddonVitestSetupFile &&
    observed.sawRunnerMissingMessage &&
    !observed.storybookBrowserOutputSeen
  const connectionTimeout =
    observed.browserSessionConnectionTimedOut && !observed.semanticProgressSeen
  const budgetExpired = session.reason === 'deadline'
  const killedByWatchdog =
    outcome.stalled ||
    outcome.hung ||
    outcome.semanticStall ||
    budgetExpired ||
    session.reason === 'parent-signal'
  return {
    bootstrap,
    budgetExpired,
    code: spawnFailed || killedByWatchdog ? 1 : (session.exit.code ?? 1),
    durationMs: finishedAt - startedAt,
    exitCode: spawnFailed ? 1 : session.exit.code,
    firstTestOutputAtMs: relativeTo(startedAt, observed.firstTestOutputAt),
    hung: outcome.hung || connectionTimeout,
    isStall: outcome.stalled,
    lastOutputAgeMs: finishedAt - observed.lastOutputAt,
    newOptimizeDeps: observed.newOptimizeDeps,
    optimizerReadyAtMs: relativeTo(startedAt, observed.optimizerReadyAt),
    optimizerReloadFromNewDeps,
    resultFileDetectedAtMs: relativeTo(startedAt, outcome.resultFileDetectedAt),
    retryable:
      !spawnFailed &&
      !budgetExpired &&
      session.reason !== 'parent-signal' &&
      !outcome.semanticStall &&
      !optimizerReloadFromNewDeps &&
      (observed.retryableViteFailure ||
        runnerMissing ||
        (!observed.semanticProgressSeen && (outcome.stalled || outcome.hung || connectionTimeout))),
    runnerMissing,
    semanticProgress: observed.semanticProgressSeen,
    semanticStall: outcome.semanticStall,
    signal: session.exit.signal,
    viteFetchFailure: observed.retryableViteFailure,
    viteReady: observed.startupComplete,
  }
}

const baseResult = (bootstrap: StorybookBrowserBootstrapSnapshot): AttemptResult => ({
  bootstrap,
  budgetExpired: false,
  code: 1,
  durationMs: 0,
  exitCode: null,
  firstTestOutputAtMs: null,
  hung: false,
  isStall: false,
  lastOutputAgeMs: 0,
  newOptimizeDeps: [],
  optimizerReadyAtMs: null,
  optimizerReloadFromNewDeps: false,
  resultFileDetectedAtMs: null,
  retryable: false,
  runnerMissing: false,
  semanticProgress: false,
  semanticStall: false,
  signal: null,
  viteFetchFailure: false,
  viteReady: false,
})

/** The command could not be started: failed, never retryable. */
export function failedSpawnAttempt(
  bootstrap: StorybookBrowserBootstrapSnapshot,
  startedAt: number,
  lastOutputAt: number,
  now: number,
): AttemptResult {
  return {
    ...baseResult(bootstrap),
    durationMs: now - startedAt,
    exitCode: 1,
    lastOutputAgeMs: now - lastOutputAt,
  }
}

/** The session budget ran out before the session produced a result. */
export function expiredAttempt(
  bootstrap: StorybookBrowserBootstrapSnapshot,
  startedAt: number,
  now: number,
): AttemptResult {
  return { ...baseResult(bootstrap), budgetExpired: true, durationMs: now - startedAt }
}

export function formatAttemptResult(attempt: number, result: AttemptResult): string {
  return `${[
    `[storybook-browser] attempt=${attempt} finished in ${result.durationMs}ms`,
    `code=${result.exitCode ?? 'null'}`,
    `signal=${result.signal ?? 'null'}`,
    `resolvedCode=${result.code}`,
    `retryable=${String(result.retryable)}`,
    `stall=${String(result.isStall)}`,
    `hang=${String(result.hung)}`,
    `runnerMissing=${String(result.runnerMissing)}`,
    `budgetExpired=${String(result.budgetExpired)}`,
    `semanticProgress=${String(result.semanticProgress)}`,
    `semanticStall=${String(result.semanticStall)}`,
    `viteReady=${String(result.viteReady)}`,
    `optimizerReadyAtMs=${result.optimizerReadyAtMs ?? 'none'}`,
    `firstTestOutputAtMs=${result.firstTestOutputAtMs ?? 'none'}`,
    `lastOutputAgeMs=${result.lastOutputAgeMs}`,
    `resultFileAtMs=${result.resultFileDetectedAtMs ?? 'none'}`,
    `bootstrapStage=${result.bootstrap.terminalStage}`,
    `bootstrapTimeline=${JSON.stringify(result.bootstrap.timeline)}`,
    `orchestratorDisconnectCount=${result.bootstrap.orchestratorDisconnectCount}`,
    `requestFailureCount=${result.bootstrap.requestFailureCount}`,
    `requestFailureSamples=${JSON.stringify(result.bootstrap.requestFailureSamples)}`,
    `viteFetchFailure=${String(result.viteFetchFailure)}`,
    `optimizerReloadFromNewDeps=${String(result.optimizerReloadFromNewDeps)}`,
    `newOptimizeDeps=${result.newOptimizeDeps.join(',') || 'none'}`,
  ].join('; ')}\n`
}
