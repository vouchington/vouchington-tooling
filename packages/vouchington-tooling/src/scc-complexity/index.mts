import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SharedContext } from '../shared-context/index.mts'
import {
  baselineEntryByScopeAndFile,
  baselineKey,
  validateSccComplexityBaseline,
} from './baseline.mts'
import { parseSccComplexityValues } from './parser.mts'
import type {
  SccComplexityBaseline,
  SccComplexityOptions,
  SccComplexityScope,
  SccComplexityValue,
  SccComplexityViolation,
} from './types.mts'
const execFileAsync = promisify(execFile)
export { parseSccComplexityBaseline, SCC_COMPLEXITY_BASELINE_VERSION } from './baseline.mts'
export type {
  SccComplexityBaseline,
  SccComplexityBaselineEntry,
  SccComplexityOptions,
  SccComplexityScope,
  SccComplexityViolation,
} from './types.mts'
export const SCC_COMPLEXITY_LIMIT = 50
const DEFAULT_INCLUDE_EXT = 'js,mts,jsx,ts,tsx'
const DEFAULT_EXCLUDE_DIR = '.git,fixtures,__tests__,test-helpers'
const DEFAULT_NOT_MATCH = String.raw`\.(test|spec)\.`
const DEFAULT_TMPDIR_PREFIX = 'scc-complexity-'
type RunScc = (outputPath: string, scope?: SccComplexityScope) => Promise<string>
export function buildSccArgs(options: SccComplexityOptions = {}): string[] {
  return [
    '--format',
    'json',
    '--include-ext',
    options.includeExt ?? DEFAULT_INCLUDE_EXT,
    '--by-file',
    '--sort',
    'complexity',
    '--exclude-dir',
    options.excludeDir ?? DEFAULT_EXCLUDE_DIR,
    '--not-match',
    options.notMatch ?? DEFAULT_NOT_MATCH,
    '--no-cocomo',
  ]
}

export async function checkSccComplexity(
  ctx: SharedContext,
  options: SccComplexityOptions = {},
  runScc?: RunScc,
): Promise<{ errors: string[] }> {
  if (!ctx.isInsideGitRepo)
    return { errors: [`::error::${ctx.repoRoot} is not inside a git repository`] }
  const dir = await mkdtemp(join(tmpdir(), options.tmpdirPrefix ?? DEFAULT_TMPDIR_PREFIX))
  try {
    const scopes = scopesFor(options)
    const results = await runScopes(ctx, options, scopes, dir, runScc)
    if (options.baseline)
      validateSccComplexityBaseline(options.baseline, scopes, ctx.trackedFileSet, results)
    return { errors: formatViolations(results, scopes, options.baseline) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { errors: [`::error::scc-complexity failed: ${message}`] }
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

export function parseSccComplexityViolations(
  json: string,
  trackedFileSet: ReadonlySet<string>,
  limit = SCC_COMPLEXITY_LIMIT,
): SccComplexityViolation[] {
  return parseSccComplexityValues(json, trackedFileSet)
    .filter((value) => value.complexity > limit)
    .toSorted(compare)
}

function scopesFor(options: SccComplexityOptions): readonly SccComplexityScope[] {
  if (!options.scopes) {
    if (options.baseline) throw new Error('baseline requires named scopes')
    return [{ includePaths: [], name: '', ...options }]
  }
  if (options.scopes.length === 0) throw new Error('scopes must not be empty')
  const names = new Set<string>()
  for (const scope of options.scopes) {
    if (!scope.name || names.has(scope.name))
      throw new Error(`scope name ${scope.name || '(empty)'} is invalid`)
    if (scope.includePaths.length === 0 || scope.includePaths.some((path) => !path))
      throw new Error(`scope ${scope.name} must include at least one path`)
    names.add(scope.name)
  }
  return options.scopes
}

async function runScopes(
  ctx: SharedContext,
  options: SccComplexityOptions,
  scopes: readonly SccComplexityScope[],
  dir: string,
  runScc?: RunScc,
): Promise<Map<string, SccComplexityValue[]>> {
  const results = new Map<string, SccComplexityValue[]>()
  for (const scope of scopes) {
    const outputPath = join(dir, `${scope.name || 'default'}.json`)
    const resolve =
      runScc ??
      ((path: string, current?: SccComplexityScope) =>
        runSccJson(ctx.repoRoot, path, options, current))
    results.set(
      scope.name,
      parseSccComplexityValues(await resolve(outputPath, scope), ctx.trackedFileSet),
    )
  }
  return results
}

function formatViolations(
  results: ReadonlyMap<string, readonly SccComplexityValue[]>,
  scopes: readonly SccComplexityScope[],
  baseline?: SccComplexityBaseline,
): string[] {
  const entries = baselineEntryByScopeAndFile(baseline)
  return scopes.flatMap((scope) =>
    (results.get(scope.name) ?? []).flatMap((value) => {
      const limit = scope.limit ?? SCC_COMPLEXITY_LIMIT
      if (value.complexity <= limit) return []
      const entry = entries.get(baselineKey({ file: value.file, scope: scope.name }))
      if (entry && value.complexity <= entry.complexity) return []
      const prefix = scope.name ? `[${scope.name}] ` : ''
      const detail = entry
        ? `scc complexity ${value.complexity} exceeds baseline ceiling ${entry.complexity}`
        : `scc complexity ${value.complexity} exceeds ${limit}; simplify or split this file`
      return [`::error file=${value.file}::${prefix}${value.file}: ${detail}`]
    }),
  )
}

async function runSccJson(
  repoRoot: string,
  outputPath: string,
  options: SccComplexityOptions,
  scope?: SccComplexityScope,
): Promise<string> {
  try {
    await execFileAsync(
      options.command ?? 'scc',
      [
        ...buildSccArgs({ ...options, ...scope }),
        ...(scope?.includePaths ?? []),
        '--output',
        outputPath,
      ],
      { cwd: repoRoot, maxBuffer: 1024 * 1024 },
    )
  } catch (error) {
    if (isNodeSystemError(error) && error.code === 'ENOENT')
      throw new Error('scc executable not found; install with mise install', { cause: error })
    throw error
  }
  return readFile(outputPath, 'utf8')
}

function compare(a: SccComplexityViolation, b: SccComplexityViolation): number {
  return b.complexity - a.complexity || a.file.localeCompare(b.file)
}

function isNodeSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
