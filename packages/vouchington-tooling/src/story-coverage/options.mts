import { resolve } from 'node:path'

export type StoryCoverageRequest = {
  root: string
  componentRoot: string
  storyRoot: string
  aliases?: Readonly<Record<string, string>>
  sourceExtensions: readonly string[]
  componentExtensions: readonly string[]
  marker: RegExp
  storyFilePattern: RegExp
  exclusions?: Readonly<Record<string, unknown>>
  exclusionsLabel?: string
}

export type StoryCoverageConfig = {
  root: string
  componentRoot: string
  storyRoot: string
  aliases: Readonly<Record<string, string>>
  sourceExtensions: readonly string[]
  componentExtensions: readonly string[]
  marker: RegExp
  storyFilePattern: RegExp
  exclusions: Readonly<Record<string, unknown>>
  exclusionsLabel: string
}

export function storyCoverageConfig(request: StoryCoverageRequest): StoryCoverageConfig {
  const componentRoot = directoryRoot(request.componentRoot, 'componentRoot')
  const storyRoot = directoryRoot(request.storyRoot, 'storyRoot')
  if (componentRoot.startsWith(storyRoot) || storyRoot.startsWith(componentRoot)) {
    throw new Error('componentRoot and storyRoot must not overlap')
  }
  requireExtensions(request.sourceExtensions, 'sourceExtensions')
  requireExtensions(request.componentExtensions, 'componentExtensions')
  if (request.exclusions !== undefined && !plainRecord(request.exclusions)) {
    throw new Error('exclusions must be a plain object')
  }
  return {
    root: resolve(request.root),
    componentRoot,
    storyRoot,
    aliases: request.aliases ?? {},
    sourceExtensions: request.sourceExtensions,
    componentExtensions: request.componentExtensions,
    marker: request.marker,
    storyFilePattern: request.storyFilePattern,
    exclusions: request.exclusions ?? {},
    exclusionsLabel: request.exclusionsLabel ?? 'the exclusions map',
  }
}

/** Resets `lastIndex` so a global or sticky pattern can match more than once. */
export function patternMatches(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0
  return pattern.test(value)
}

function directoryRoot(value: string, label: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '')
  if (
    normalized.startsWith('/') ||
    normalized.split('/').includes('..') ||
    normalized === '' ||
    normalized === '.'
  ) {
    throw new Error(`${label} must be a relative directory inside the root`)
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function requireExtensions(extensions: readonly string[], label: string): void {
  if (extensions.length === 0) throw new Error(`${label} must not be empty`)
  for (const extension of extensions) {
    if (!extension.startsWith('.')) throw new Error(`${label} entries must start with '.'`)
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
