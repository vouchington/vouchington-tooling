import picomatch from 'picomatch'
import { normalizeFilename, type RuleContextLike } from './ast-helpers.mts'

export const DEFAULT_CURSOR_INCLUDE = ['**/*.{ts,mts,tsx,js,mjs,cjs}']
const DEFAULT_CURSOR_ANNOTATION = '^\\s*/\\*\\s*\\S[^]*?\\*/'

export type CursorModuleConfig = {
  modules: ReadonlySet<string>
  executors: ReadonlySet<string>
}

export type ResolvedCursorOptions = CursorModuleConfig & {
  include: readonly string[]
  exclude: readonly string[]
  includeFiles: readonly string[]
  annotation: RegExp
}

export function resolveCursorContractOptions(raw: unknown): ResolvedCursorOptions | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const modules = stringArray(record.modules)
  const executors = stringArray(record.executors)
  if (!modules?.length || !executors?.length) return null
  if (record.annotation !== undefined && typeof record.annotation !== 'string') return null
  const include = optionalStringArray(record.include, record.include !== undefined)
  const exclude = optionalStringArray(record.exclude, record.exclude !== undefined)
  const includeFiles = optionalStringArray(record.includeFiles, record.includeFiles !== undefined)
  if (include === null || exclude === null || includeFiles === null) return null
  let annotation: RegExp
  try {
    annotation = new RegExp(
      typeof record.annotation === 'string' ? record.annotation : DEFAULT_CURSOR_ANNOTATION,
    )
  } catch {
    throw new Error(
      `postgres-cursor-call-contract annotation is not a valid regular expression: ${String(record.annotation)}`,
    )
  }
  return {
    modules: new Set(modules),
    executors: new Set(executors),
    include: include ?? DEFAULT_CURSOR_INCLUDE,
    exclude: exclude ?? [],
    includeFiles: (includeFiles ?? []).map((file) => file.replace(/^(?:\.\/)+/, '')),
    annotation,
  }
}

export function matchesCursorFile(
  context: RuleContextLike,
  options: ResolvedCursorOptions,
): boolean {
  const filename = normalizeFilename(context).replace(/^(?:\.\/)+/, '')
  if (options.includeFiles.includes(filename)) return true
  if (options.exclude.length > 0 && picomatch.isMatch(filename, [...options.exclude])) return false
  return picomatch.isMatch(filename, [...options.include])
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return undefined
  return value
}

function optionalStringArray(value: unknown, present: boolean): string[] | undefined | null {
  if (!present) return undefined
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null
}
