import { coverageDisposition, type CoverageConfig, type CoverageScope } from 'coverage-check'
// `coverage-check` exports matchRule only through its documented `./src/*.mts` subpath.
import { matchRule } from 'coverage-check/src/rules.mts'

/** Positive-threshold paths that the coverage gate expects but Vitest will not instrument. */
export function findCoverageScopeMismatches(
  files: readonly string[],
  config: CoverageConfig,
  instrumentedScope: CoverageScope,
): string[] {
  const scope = config.scope
  if (scope === undefined) throw new Error('coverage rules file is missing its scope block')
  return files.filter((file) => {
    if (coverageDisposition(file, scope) === 'ignored') return false
    const rule = matchRule(file, config.rules)
    return (
      rule !== null &&
      rule.patch_coverage_min > 0 &&
      coverageDisposition(file, instrumentedScope) === 'ignored'
    )
  })
}
