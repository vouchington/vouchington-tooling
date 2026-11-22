import { EOL } from 'node:os'
import { formatActiveResources, formatProcessResources } from './vitest-fork-leak-handshake.mts'

export const DEFAULT_TEARDOWN_OVERRUN_TAG = '[vitest-teardown-overrun]'

export interface TeardownOverrunDiagnosticsOptions {
  /** Log tag printed on the first line; defaults to `[vitest-teardown-overrun]`. */
  tag?: string
}

/**
 * Process and active-resource snapshot for the moment Vitest's exit watchdog fires at the
 * teardownTimeout deadline. Deliberately excludes worker-exit error text and failure vocabulary
 * so it never reads as a Vitest test failure.
 */
export function formatTeardownOverrunDiagnostics(
  options: TeardownOverrunDiagnosticsOptions = {},
): string {
  const lines = [
    '',
    options.tag ?? DEFAULT_TEARDOWN_OVERRUN_TAG,
    `process: ${formatProcessResources()}`,
    `active resources: ${formatActiveResources()}`,
  ]
  return `${lines.join(EOL)}${EOL}`
}
