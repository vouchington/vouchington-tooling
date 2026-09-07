import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SharedContext } from '../shared-context/index.mts'
import {
  baselineEntryByScopeAndFile,
  normalizeSccComplexityBaseline,
  validateSccComplexityBaseline,
} from './baseline.mts'
import { SCC_COMPLEXITY_LIMIT } from './constants.mts'
import { canonicalRepoPath } from './paths.mts'
import { parseSccComplexityValues } from './parser.mts'
import { normalizeScopes, scopesFor } from './scope-config.mts'
import { escapeWorkflowCommandMessage, escapeWorkflowCommandProperty } from './workflow-command.mts'
import type {
  SccComplexityBaseline,
  SccComplexityOptions,
  SccComplexityScope,
  SccComplexityValue,
  SccComplexityViolation,
} from './types.mts'
const execFileAsync = promisify(execFile)
export { parseSccComplexityBaseline, SCC_COMPLEXITY_BASELINE_VERSION } from './baseline.mts'
export { SCC_COMPLEXITY_LIMIT } from './constants.mts'
export type {
  SccComplexityBaseline,
  SccComplexityBaselineEntry,
  SccComplexityOptions,
  SccComplexityScope,
  SccComplexityViolation,
} from './types.mts'
const DEFAULT_INCLUDE_EXT = 'js,mts,jsx,ts,tsx'
const DEFAULT_EXCLUDE_DIR = '.git,fixtures,__tests__,test-helpers'
const DEFAULT_NOT_MATCH = String.raw`\.(test|spec)\.`
const DEFAULT_TMPDIR_PREFIX = 'scc-complexity-'
type RunScc = (outputPath: string, scope?: SccComplexityScope) => Promise<string>
type SccScopeResult = { scope: SccComplexityScope; values: SccComplexityValue[] }
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
    const scopes = await normalizeScopes(scopesFor(options), ctx.repoRoot, options.limit)
    const trackedFileSet = new Set(
      [...ctx.trackedFileSet].map((file) => canonicalRepoPath(ctx.repoRoot, file)),
    )
    const baseline =
      options.baseline && normalizeSccComplexityBaseline(options.baseline, ctx.repoRoot)
    const results = await runScopes(ctx, options, scopes, dir, trackedFileSet, runScc)
    if (baseline)
      validateSccComplexityBaseline(
        baseline,
        scopes,
        trackedFileSet,
        new Map(results.map(({ scope, values }) => [scope.name, values])),
      )
    return { errors: formatViolations(results, baseline) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { errors: [`::error::scc-complexity failed: ${escapeWorkflowCommandMessage(message)}`] }
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

async function runScopes(
  ctx: SharedContext,
  options: SccComplexityOptions,
  scopes: readonly SccComplexityScope[],
  dir: string,
  trackedFileSet: ReadonlySet<string>,
  runScc?: RunScc,
): Promise<SccScopeResult[]> {
  const results: SccScopeResult[] = []
  for (const [index, scope] of scopes.entries()) {
    const outputPath = join(dir, `scope-${index}.json`)
    const resolve: RunScc = runScc ?? ((path) => runSccJson(ctx.repoRoot, path, options, scope))
    const values = parseSccComplexityValues(
      await resolve(outputPath, scope),
      trackedFileSet,
      ctx.repoRoot,
    )
    const outside = values.find((value) => !isInScopeResult(scope, value.file))
    if (outside)
      throw new Error(`scope ${scope.name} received result outside its paths: ${outside.file}`)
    results.push({ scope, values })
  }
  return results
}

function formatViolations(
  results: readonly SccScopeResult[],
  baseline?: SccComplexityBaseline,
): string[] {
  const entries = baselineEntryByScopeAndFile(baseline)
  return results.flatMap(({ scope, values }) =>
    values.flatMap((value) => {
      const limit = scope.limit ?? SCC_COMPLEXITY_LIMIT
      if (value.complexity <= limit) return []
      const entry = entries.get(scope.name)?.get(value.file)
      if (entry && value.complexity <= entry.complexity) return []
      const prefix = scope.name ? `[${scope.name}] ` : ''
      const detail = entry
        ? `scc complexity ${value.complexity} exceeds baseline ceiling ${entry.complexity}`
        : `scc complexity ${value.complexity} exceeds ${limit}; simplify or split this file`
      return [
        `::error file=${escapeWorkflowCommandProperty(value.file)}::${escapeWorkflowCommandMessage(`${prefix}${value.file}: ${detail}`)}`,
      ]
    }),
  )
}

function isInScopeResult(scope: SccComplexityScope, file: string): boolean {
  return (
    scope.includePaths.length === 0 ||
    scope.includePaths.some((path) => file === path || file.startsWith(`${path}/`) || path === '.')
  )
}

async function runSccJson(
  repoRoot: string,
  outputPath: string,
  options: SccComplexityOptions,
  scope: SccComplexityScope,
): Promise<string> {
  try {
    await execFileAsync(
      options.command ?? 'scc',
      [...buildSccArgs({ ...options, ...scope }), ...scope.includePaths, '--output', outputPath],
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
