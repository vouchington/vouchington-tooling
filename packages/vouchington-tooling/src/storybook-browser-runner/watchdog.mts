import { resolve } from 'node:path'

import type { BrowserSessionWatchdog } from '../browser-session-runner/index.mts'
import type { OutputObserver } from './output-observer.mts'
import { writeProcessGroupSample } from './process-sample.mts'
import type { StorybookBrowserRunnerDeps } from './types.mts'

/** What the watchdog decided, read by the attempt result once the session ends. */
export type WatchdogOutcome = {
  hung: boolean
  resultFileDetectedAt: number | null
  semanticStall: boolean
  stalled: boolean
}

export type StorybookWatchdogOptions = {
  completionFile: string | undefined
  deps: Pick<
    StorybookBrowserRunnerDeps,
    'clearInterval' | 'cwd' | 'existsSync' | 'now' | 'sampleProcessGroup' | 'setInterval' | 'stderr'
  >
  hangMs: number
  observer: OutputObserver
  outcome: WatchdogOutcome
  /** The spawned test command's process group (its pid), once started. */
  processGroupId: () => number | undefined
  stallMs: number
}

const MAX_WATCHDOG_INTERVAL_MS = 5000

/** Terminates the attempt on an optimizer stall, a mid-suite stall, or a tester-connection hang. */
export function createStorybookWatchdog(options: StorybookWatchdogOptions): BrowserSessionWatchdog {
  const { deps, hangMs, observer, outcome, stallMs } = options
  return (controller) => {
    // The first decision is final: later ticks during the termination grace must not repeat it.
    let decided = false
    const check = () => {
      const now = deps.now()
      sampleCompletionFile(options)
      if (decided) return
      const seen = observer.snapshot()
      if (
        !seen.semanticProgressSeen &&
        seen.optimizerLastProgressAt != null &&
        now - seen.optimizerLastProgressAt >= stallMs
      ) {
        outcome.stalled = true
        deps.stderr.write(
          `[storybook-browser] Vite optimizer made no startup progress for ${stallMs}ms; terminating attempt\n`,
        )
        decided = true
        writeProcessGroupSample(deps, options.processGroupId())
        controller.terminate()
      } else if (seen.semanticProgressSeen && now - seen.lastSemanticProgressAt >= hangMs) {
        outcome.semanticStall = true
        deps.stderr.write(
          `[storybook-browser] no semantic test progress for ${hangMs}ms; terminating terminal mid-suite stall (last progress ${now - seen.lastSemanticProgressAt}ms ago: ${seen.lastSemanticProgressLine ?? 'no marker line'})\n`,
        )
        decided = true
        writeProcessGroupSample(deps, options.processGroupId())
        controller.terminate()
      } else if (
        seen.anyOutputSeen &&
        !seen.semanticProgressSeen &&
        now - seen.lastHangProgressAt >= hangMs
      ) {
        outcome.hung = true
        deps.stderr.write(
          `[storybook-browser] no test output for ${hangMs}ms after Vite startup — suspected Vitest/Chromium tester-connection hang; last output:\n${seen.outputBuffer}\n`,
        )
        decided = true
        writeProcessGroupSample(deps, options.processGroupId())
        controller.terminate()
      }
    }
    const interval = deps.setInterval(check, Math.min(MAX_WATCHDOG_INTERVAL_MS, stallMs, hangMs))
    return () => deps.clearInterval(interval)
  }
}

/** Records when the completion file first appears; also sampled once more as an attempt ends. */
export function sampleCompletionFile(
  options: Pick<StorybookWatchdogOptions, 'completionFile' | 'deps' | 'outcome'>,
): void {
  const { completionFile, deps, outcome } = options
  if (!completionFile || outcome.resultFileDetectedAt != null) return
  if (deps.existsSync(resolve(deps.cwd, completionFile))) outcome.resultFileDetectedAt = deps.now()
}

export function isSpawnedProcessGroupId(
  processGroupId: number | undefined,
): processGroupId is number {
  return (
    processGroupId != null &&
    Number.isSafeInteger(processGroupId) &&
    processGroupId > 1 &&
    processGroupId <= 2_147_483_647
  )
}
