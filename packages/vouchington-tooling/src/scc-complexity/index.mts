import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { SharedContext } from '../shared-context/index.mts'

const execFileAsync = promisify(execFile)

export const SCC_COMPLEXITY_LIMIT = 50
const DEFAULT_INCLUDE_EXT = 'js,mts,jsx,ts,tsx'
const DEFAULT_EXCLUDE_DIR = '.git,fixtures,__tests__,test-helpers'
const DEFAULT_NOT_MATCH = String.raw`\.(test|spec)\.`
const DEFAULT_TMPDIR_PREFIX = 'scc-complexity-'

export interface SccComplexityOptions {
  limit?: number
  includeExt?: string
  excludeDir?: string
  notMatch?: string
  tmpdirPrefix?: string
  command?: string
}

interface SccFile {
  Location?: unknown
  Complexity?: unknown
}

interface SccLanguage {
  Files?: unknown
}

export interface SccComplexityViolation {
  file: string
  complexity: number
}

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
  runScc?: (outputPath: string) => Promise<string>,
): Promise<{ errors: string[] }> {
  if (!ctx.isInsideGitRepo) {
    return { errors: [`::error::${ctx.repoRoot} is not inside a git repository`] }
  }

  const dir = await mkdtemp(join(tmpdir(), options.tmpdirPrefix ?? DEFAULT_TMPDIR_PREFIX))
  const outputPath = join(dir, 'scc.json')
  const limit = options.limit ?? SCC_COMPLEXITY_LIMIT
  try {
    const resolve = runScc ?? ((path: string) => runSccJson(ctx.repoRoot, path, options))
    const json = await resolve(outputPath)
    const violations = parseSccComplexityViolations(json, ctx.trackedFileSet, limit)
    return { errors: violations.map((violation) => formatViolation(violation, limit)) }
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
  const parsed = JSON.parse(json) as unknown
  if (!Array.isArray(parsed)) throw new Error('scc JSON output must be an array')

  const violations: SccComplexityViolation[] = []
  for (const language of parsed as SccLanguage[]) {
    if (!Array.isArray(language.Files)) continue
    for (const file of language.Files as SccFile[]) {
      if (typeof file.Location !== 'string') continue
      if (!trackedFileSet.has(file.Location)) continue
      if (typeof file.Complexity !== 'number') continue
      if (file.Complexity <= limit) continue
      violations.push({ file: file.Location, complexity: file.Complexity })
    }
  }

  return violations.toSorted((a, b) => b.complexity - a.complexity || a.file.localeCompare(b.file))
}

async function runSccJson(
  repoRoot: string,
  outputPath: string,
  options: SccComplexityOptions,
): Promise<string> {
  try {
    await execFileAsync(
      options.command ?? 'scc',
      [...buildSccArgs(options), '--output', outputPath],
      {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024,
      },
    )
  } catch (error) {
    if (isNodeSystemError(error) && error.code === 'ENOENT') {
      throw new Error('scc executable not found; install with mise install', { cause: error })
    }
    throw error
  }
  return readFile(outputPath, 'utf8')
}

function formatViolation({ file, complexity }: SccComplexityViolation, limit: number): string {
  return `::error file=${file}::${file}: scc complexity ${complexity} exceeds ${limit}; simplify or split this file`
}

function isNodeSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
