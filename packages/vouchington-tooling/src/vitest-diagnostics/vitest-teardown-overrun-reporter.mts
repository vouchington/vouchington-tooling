import type { Reporter } from 'vitest/node'
import {
  formatTeardownOverrunDiagnostics,
  type TeardownOverrunDiagnosticsOptions,
} from './vitest-teardown-overrun-diagnostics.mts'

class VitestTeardownOverrunReporter implements Reporter {
  readonly #options: TeardownOverrunDiagnosticsOptions

  constructor(options: TeardownOverrunDiagnosticsOptions) {
    this.#options = options
  }

  // Fired by Vitest's exit() watchdog at the teardownTimeout deadline, in the main process,
  // right before it force-exits: the last chance to capture what teardown was still doing.
  onProcessTimeout(): void {
    process.stderr.write(formatTeardownOverrunDiagnostics(this.#options))
  }
}

/** Writes teardown-overrun diagnostics to stderr when Vitest's exit watchdog fires. */
export function createVitestTeardownOverrunReporter(
  options: TeardownOverrunDiagnosticsOptions = {},
): Reporter {
  return new VitestTeardownOverrunReporter(options)
}
