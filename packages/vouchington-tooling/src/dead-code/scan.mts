import { readFile } from 'node:fs/promises'
import { join, matchesGlob } from 'node:path'
import { rowsFromReport, type BaselineRow, type FindingIdentity } from './baseline.mts'
import { runChildCommand } from './child-command.mts'

/**
 * Builds the finding filter. Findings in test and spec files, unused files that are only
 * used by tests, and any path matching one of `excludeGlobs` are not counted.
 */
export function createFindingFilter(
  excludeGlobs: readonly string[] = [],
): (finding: FindingIdentity, raw: Record<string, unknown>) => boolean {
  return (finding, raw) => {
    if (
      finding.category === 'unused-file' &&
      Array.isArray(raw['reasons']) &&
      raw['reasons'].includes('used-only-by-tests')
    )
      return false
    if (excludeGlobs.some((glob) => matchesGlob(finding.path, glob))) return false
    return !/\.(test|spec)\.[^/]+$/.test(finding.path)
  }
}

/** Runs `binary --dead-code` over a snapshot and returns its baseline rows. */
export async function scanDeadCode(
  snapshotRoot: string,
  reportRoot: string,
  binary: string,
  remaining?: () => number,
  options: { configPath?: string | undefined; excludeGlobs?: readonly string[] | undefined } = {},
): Promise<BaselineRow[]> {
  await runChildCommand(
    binary,
    [
      '--dead-code',
      '--no-gitignore',
      '--config',
      options.configPath ?? '.jscpd.json',
      '--reporters',
      'json',
      '--output',
      reportRoot,
      '--exit-code',
      '0',
      '.',
    ],
    snapshotRoot,
    remaining,
  )
  const report = JSON.parse(
    await readFile(join(reportRoot, 'basta-report.json'), 'utf8'),
  ) as unknown
  return rowsFromReport(report, createFindingFilter(options.excludeGlobs))
}
