import { latestStorybookProgressSequence } from '../vitest-diagnostics/index.mts'
import { StringDecoder } from 'node:string_decoder'

import type { StorybookBrowserBootstrapTelemetry } from './bootstrap-telemetry.mts'
import type { StorybookBrowserDiagnostics } from './diagnostics.mts'
import {
  hasAddonVitestSetupFile,
  optimizerProgressPattern,
  progressMarkerLine,
  viteServerFetchFailurePattern,
  viteServerScriptNetworkChangePattern,
  vitestRunnerMissingMarker,
  type ProjectOutputPatterns,
} from './output-patterns.mts'
import {
  initialObserverState,
  type OutputObserverSnapshot,
  type OutputObserverState,
} from './observer-state.mts'
import type { StorybookQuietOutput } from './quiet-output.mts'
import {
  hasStorybookBrowserViteDependencyReady,
  hasStorybookBrowserViteReady,
  hasStorybookViteNewDependenciesFound,
  hasStorybookViteOptimizerReload,
  parseStorybookViteNewDependencies,
  stripAnsi,
} from './vite-detectors.mts'

type Source = 'stderr' | 'stdout'
type Sink = Pick<NodeJS.WriteStream, 'write'>

export type OutputObserverOptions = {
  diagnostics: StorybookBrowserDiagnostics
  now: () => number
  patterns: ProjectOutputPatterns
  progressPrefix: string
  quietOutput: StorybookQuietOutput
  startedAt: number
  stderr: Sink
  stdout: Sink
  telemetry: StorybookBrowserBootstrapTelemetry
}

const BUFFER_CHARS = 1000
// One less than the longest optimizer progress marker, so the overlap cannot hold a whole marker.
const OPTIMIZER_MARKER_OVERLAP = 32
// A progress marker line is at most 512 bytes, so this tail covers one split across chunks.
const PROGRESS_MARKER_OVERLAP = 600

/** Reads child output and latches the startup, progress and failure markers the policy needs. */
export class OutputObserver {
  private readonly newOptimizeDeps = new Set<string>()
  private readonly options: OutputObserverOptions
  private lastSemanticSequence = 0
  private readonly decoders = {
    stderr: new StringDecoder('utf8'),
    stdout: new StringDecoder('utf8'),
  }
  private state: OutputObserverState

  constructor(options: OutputObserverOptions) {
    this.options = options
    this.state = initialObserverState(options.startedAt)
  }

  snapshot(): OutputObserverSnapshot {
    return { ...this.state, newOptimizeDeps: [...this.newOptimizeDeps] }
  }

  observe(source: Source, chunk: string | Buffer): void {
    const { now: clock, startedAt, telemetry } = this.options
    const now = clock()
    // Decode per stream so a multibyte character split across chunks survives.
    const text = this.decoders[source].write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    const observed = telemetry.consume(source, text, now - startedAt)
    if (observed.output) this.emit(source, observed.output)
    const { patterns } = this.options
    const state = this.state
    // The marker can be split across chunks, so it is also matched against the previous tail.
    const joined = state.outputBuffer.slice(-OPTIMIZER_MARKER_OVERLAP) + text
    // Progress markers are read from the whole chunk, not the truncated rolling buffer.
    const progressText = stripAnsi(state.outputBuffer.slice(-PROGRESS_MARKER_OVERLAP) + text)
    state.outputBuffer = (state.outputBuffer + text).slice(-BUFFER_CHARS)
    const plainBuffer = stripAnsi(state.outputBuffer)
    state.anyOutputSeen = true
    state.lastOutputAt = now
    const storybookOutput = plainBuffer.includes(patterns.projectMarker)
    if (observed.hasNonDiagnosticOutput || state.storybookBrowserOutputSeen) {
      state.lastHangProgressAt = now
    }
    if (optimizerProgressPattern.test(joined)) state.optimizerLastProgressAt = now
    if (hasStorybookBrowserViteDependencyReady(plainBuffer) || storybookOutput) {
      state.optimizerLastProgressAt = null
    }
    this.observeStartup(now, hasStorybookBrowserViteReady(plainBuffer) || storybookOutput)
    this.observeProgress(now, plainBuffer, progressText, storybookOutput)
    this.observeFailures(stripAnsi(text), plainBuffer)
  }

  /** Emits any unterminated lines the telemetry still holds, stdout before stderr. */
  flush(): void {
    for (const source of ['stdout', 'stderr'] as const) {
      const rest = this.decoders[source].end()
      if (rest)
        this.options.telemetry.consume(source, rest, this.options.now() - this.options.startedAt)
      const observed = this.options.telemetry.flush(
        source,
        this.options.now() - this.options.startedAt,
      )
      if (observed.output) this.emit(source, observed.output)
    }
  }

  private emit(source: Source, output: string): void {
    this.options.diagnostics.recordOutput(output)
    const visible = this.options.quietOutput.split(output, source)
    if (visible) (source === 'stdout' ? this.options.stdout : this.options.stderr).write(visible)
  }

  private observeStartup(now: number, startupNowComplete: boolean): void {
    if (this.state.startupComplete || !startupNowComplete) return
    this.state.startupComplete = true
    this.state.optimizerReadyAt ??= now
    this.state.lastHangProgressAt = now
  }

  private observeProgress(
    now: number,
    plainBuffer: string,
    progressText: string,
    storybookOutput: boolean,
  ): void {
    const { patterns, progressPrefix } = this.options
    const state = this.state
    const sequence = latestStorybookProgressSequence(progressText, progressPrefix)
    if (sequence != null && sequence > this.lastSemanticSequence) {
      this.lastSemanticSequence = sequence
      state.lastSemanticProgressLine = progressMarkerLine(progressText, progressPrefix, sequence)
      this.recordSemanticProgress(now)
    }
    if (storybookOutput && !state.storybookBrowserOutputSeen) {
      state.storybookBrowserOutputSeen = true
      this.recordSemanticProgress(now)
    }
    if (
      state.startupComplete &&
      !state.storybookBrowserOutputSeen &&
      patterns.connectionTimeout.test(plainBuffer)
    ) {
      state.browserSessionConnectionTimedOut = true
    }
    if (patterns.testOutput.test(plainBuffer)) state.firstTestOutputAt ??= now
  }

  private recordSemanticProgress(now: number): void {
    const state = this.state
    state.semanticProgressSeen = true
    state.lastSemanticProgressAt = now
    state.firstTestOutputAt ??= now
    this.options.telemetry.recordSemanticProgress(now - this.options.startedAt)
  }

  private observeFailures(plainText: string, plainBuffer: string): void {
    const state = this.state
    if (
      viteServerFetchFailurePattern.test(plainBuffer) ||
      (!state.semanticProgressSeen && viteServerScriptNetworkChangePattern.test(plainBuffer))
    ) {
      state.retryableViteFailure = true
    }
    const either = (check: (text: string) => boolean) => check(plainText) || check(plainBuffer)
    if (either(hasStorybookViteNewDependenciesFound)) state.sawNewOptimizeDeps = true
    if (either(hasStorybookViteOptimizerReload)) state.sawOptimizerReload = true
    for (const name of parseStorybookViteNewDependencies(plainText)) this.newOptimizeDeps.add(name)
    if (!state.sawAddonVitestSetupFile && hasAddonVitestSetupFile(plainText, plainBuffer)) {
      state.sawAddonVitestSetupFile = true
    }
    if (!state.sawRunnerMissingMessage && either((t) => t.includes(vitestRunnerMissingMarker))) {
      state.sawRunnerMissingMessage = true
    }
  }
}
