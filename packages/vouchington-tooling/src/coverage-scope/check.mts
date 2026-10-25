import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { loadCoverageConfig, type CoverageScope } from 'coverage-check'
import { findCoverageScopeMismatches } from './mismatches.mts'

/** Globs of the files the coverage collector instruments (Vitest `coverage.include`/`exclude`). */
export interface InstrumentedGlobs {
  include: readonly string[]
  exclude: readonly string[]
}

export interface CheckCoverageScopeOptions {
  cwd: string
  /** Rules file, relative to `cwd`. Defaults to `.coverage-rules.yml`. */
  rulesFile?: string
  instrumentedScope: InstrumentedGlobs
  /** Tracked repository paths. Defaults to `git ls-files -z` in `cwd`. */
  listFiles?: (cwd: string) => readonly string[]
}

export function listTrackedFiles(cwd: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
}

/** Returns tracked paths a positive-threshold rule requires but the collector would not instrument. */
export function checkCoverageScope(options: CheckCoverageScopeOptions): string[] {
  const { cwd, rulesFile = '.coverage-rules.yml', instrumentedScope } = options
  const instrumented: CoverageScope = {
    version: 1,
    analyzer: 'javascript',
    include: [...instrumentedScope.include],
    ignored: [...instrumentedScope.exclude],
  }
  const config = loadCoverageConfig(resolve(cwd, rulesFile))
  const files = (options.listFiles ?? listTrackedFiles)(cwd)
  return findCoverageScopeMismatches(files, config, instrumented)
}
