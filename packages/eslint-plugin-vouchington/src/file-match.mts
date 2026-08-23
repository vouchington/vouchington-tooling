import picomatch from 'picomatch'
import { normalizeFilename, type RuleContextLike } from './ast-helpers.mts'

const DEFAULT_JS_INCLUDE = ['**/*.{ts,mts,tsx,js,mjs}']

export type FileMatchOptions = {
  include: readonly string[]
  exclude: readonly string[]
  includeFiles: readonly string[]
}

export function matchesFileGlobs(context: RuleContextLike, options: FileMatchOptions): boolean {
  const filename = normalizeFilename(context).replace(/^(?:\.\/)+/, '')
  if (options.includeFiles.includes(filename)) return true
  if (options.exclude.length > 0 && picomatch.isMatch(filename, [...options.exclude])) return false
  return picomatch.isMatch(filename, [...options.include])
}

export function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return undefined
  return value
}

function optionalStringArray(value: unknown, present: boolean): string[] | undefined | null {
  if (!present) return undefined
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null
}

export function resolveFileMatchOptions(
  raw: Record<string, unknown>,
  defaults: { include?: readonly string[] } = {},
): FileMatchOptions | null {
  const include = optionalStringArray(raw.include, raw.include !== undefined)
  const exclude = optionalStringArray(raw.exclude, raw.exclude !== undefined)
  const includeFiles = optionalStringArray(raw.includeFiles, raw.includeFiles !== undefined)
  if (include === null || exclude === null || includeFiles === null) return null
  return {
    include: include ?? defaults.include ?? DEFAULT_JS_INCLUDE,
    exclude: exclude ?? [],
    includeFiles: (includeFiles ?? []).map((file) => file.replace(/^(?:\.\/)+/, '')),
  }
}
