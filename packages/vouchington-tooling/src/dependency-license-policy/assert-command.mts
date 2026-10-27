import type { PnpmCommandResult } from './types.mts'

function commandFailureOutput(result: { stderr: string; stdout: string }): string {
  return result.stderr.trim() || result.stdout.trim()
}

export function assertCommandSucceeded(label: string, result: PnpmCommandResult): void {
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${label} exited with status ${String(result.status)}: ${commandFailureOutput(result)}`,
    )
  }
}
