export type OutputObserverSnapshot = {
  anyOutputSeen: boolean
  browserSessionConnectionTimedOut: boolean
  firstTestOutputAt: number | null
  lastHangProgressAt: number
  lastOutputAt: number
  lastSemanticProgressAt: number
  lastSemanticProgressLine: string | null
  lastSemanticProgressMarkerAt: number | null
  newOptimizeDeps: string[]
  optimizerLastProgressAt: number | null
  optimizerReadyAt: number | null
  outputBuffer: string
  retryableViteFailure: boolean
  sawAddonVitestSetupFile: boolean
  sawNewOptimizeDeps: boolean
  sawOptimizerReload: boolean
  sawRunnerMissingMessage: boolean
  semanticProgressSeen: boolean
  startupComplete: boolean
  storybookBrowserOutputSeen: boolean
}

export type OutputObserverState = Omit<OutputObserverSnapshot, 'newOptimizeDeps'>

export function initialObserverState(startedAt: number): OutputObserverState {
  return {
    anyOutputSeen: false,
    browserSessionConnectionTimedOut: false,
    firstTestOutputAt: null,
    lastHangProgressAt: startedAt,
    lastOutputAt: startedAt,
    lastSemanticProgressAt: startedAt,
    lastSemanticProgressLine: null,
    lastSemanticProgressMarkerAt: null,
    optimizerLastProgressAt: null,
    optimizerReadyAt: null,
    outputBuffer: '',
    retryableViteFailure: false,
    sawAddonVitestSetupFile: false,
    sawNewOptimizeDeps: false,
    sawOptimizerReload: false,
    sawRunnerMissingMessage: false,
    semanticProgressSeen: false,
    startupComplete: false,
    storybookBrowserOutputSeen: false,
  }
}
