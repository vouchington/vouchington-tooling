import type { PreflightReport } from './preflight.mts'

export function summarizePreflight(report: PreflightReport): string {
  const lines = report.entries.map((entry) =>
    entry.status === 'pass'
      ? `  ${entry.id}: pass`
      : `  ${entry.id}: blocked - ${entry.blocked.map((reason) => `${reason.code}: ${reason.detail}`).join('; ')}`,
  )
  return `Preflight ${report.status}\n${lines.join('\n')}\n`
}
