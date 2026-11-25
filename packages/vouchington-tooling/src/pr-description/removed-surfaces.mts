import type { RemovedSurface, RoutePathParser } from './pr-description-types.mts'
import { parseRemovedExports } from './removed-exports.mts'

const DIFF_GIT_OLD_PATH_RE = /^diff --git a\/(?<path>.+) b\/.+$/m
const NEW_PATH_RE = /^\+\+\+ b\/(?<path>.+)$/m
const DELETED_FILE_MODE_RE = /^deleted file mode \d+$/m
const RENAME_FROM_RE = /^rename from (?<path>.+)$/m

export const DEFAULT_REMOVAL_STOPLIST: ReadonlySet<string> = new Set(
  'base common config constants core helper helpers index main shared types util utils'.split(' '),
)

const TYPE_PRIORITY: Record<RemovedSurface['type'], number> = {
  'deleted-file': 0,
  'removed-export': 1,
  'removed-route': 2,
  'removed-script': 3,
}

export type ParseRemovedSurfacesOptions = {
  /** Maps a deleted or renamed-from file path to its public route path, if any. */
  parseRouteFromPath?: RoutePathParser
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Builds a Next.js App Router path parser for a caller-supplied root directory (for example
 * `'web/app/'` or `'src/app'`). Strips route groups like `(marketing)` and maps root `page.tsx`
 * or `route.ts` files to `'/'`.
 */
export function createAppRouterPathParser(appRoot: string): RoutePathParser {
  const normalized = appRoot.replace(/^\/+|\/+$/g, '')
  const prefix = normalized === '' ? '' : `${escapeRegExp(normalized)}/`
  const routeFileRe = new RegExp(`^${prefix}(?:(?<segments>.+)/)?(?:page|route)\\.tsx?$`)
  return (path: string): string | undefined => {
    const match = routeFileRe.exec(path)
    if (match === null) return undefined
    const segments = (match.groups?.segments ?? '').split('/')
    const kept = segments.filter((seg) => seg !== '' && !/^\(.+\)$/.test(seg))
    return kept.length > 0 ? `/${kept.join('/')}` : '/'
  }
}

function splitDiffBlocks(patch: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      blocks.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  blocks.push(current.join('\n'))
  return blocks
}

export function parseRemovedSurfaces(
  patch: string,
  options: ParseRemovedSurfacesOptions = {},
): RemovedSurface[] {
  const parseRoute = options.parseRouteFromPath
  const surfaces: RemovedSurface[] = []
  for (const block of splitDiffBlocks(patch.replaceAll('\r\n', '\n'))) {
    if (DELETED_FILE_MODE_RE.test(block)) {
      const oldPath = DIFF_GIT_OLD_PATH_RE.exec(block)?.groups?.path
      if (oldPath === undefined) continue
      surfaces.push({ path: oldPath, type: 'deleted-file' })
      const route = parseRoute?.(oldPath)
      if (route !== undefined) surfaces.push({ path: oldPath, route, type: 'removed-route' })
      continue
    }
    const renamedFrom = RENAME_FROM_RE.exec(block)?.groups?.path
    if (renamedFrom !== undefined) {
      const route = parseRoute?.(renamedFrom)
      if (route !== undefined) surfaces.push({ path: renamedFrom, route, type: 'removed-route' })
    }
    const newPath = NEW_PATH_RE.exec(block)?.groups?.path
    if (newPath === undefined) continue
    surfaces.push(...parseRemovedExports(block, newPath))
  }
  return surfaces
}

/** Collects non-deleted changed `package.json` paths from a unified diff. */
export function parseChangedPackageJsonPaths(patch: string): string[] {
  const paths: string[] = []
  for (const block of splitDiffBlocks(patch.replaceAll('\r\n', '\n'))) {
    if (DELETED_FILE_MODE_RE.test(block)) continue
    const newPath = NEW_PATH_RE.exec(block)?.groups?.path
    if (newPath !== undefined && newPath.endsWith('package.json')) paths.push(newPath)
  }
  return paths
}

function quoteIfNeeded(term: string): string {
  return /[/:]/.test(term) ? `"${term}"` : term
}

function candidateTerm(surface: RemovedSurface): string {
  if (surface.type === 'deleted-file') return quoteIfNeeded(surface.path)
  if (surface.type === 'removed-script') return quoteIfNeeded(surface.name)
  if (surface.type === 'removed-export') return surface.name
  const segments = surface.route.split('/').filter((seg) => seg !== '' && !/^\[.+\]$/.test(seg))
  return quoteIfNeeded(segments.length > 0 ? `/${segments.join('/')}` : surface.route)
}

/** Bounds and orders removal search terms by surface priority, dropping short or stoplisted terms. */
export function buildRemovalVocabulary(
  surfaces: readonly RemovedSurface[],
  limit = 12,
  stoplist: ReadonlySet<string> = DEFAULT_REMOVAL_STOPLIST,
): { terms: string[]; dropped: string[] } {
  const ordered = surfaces.toSorted((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type])
  const seen = new Set<string>()
  const terms: string[] = []
  const dropped: string[] = []

  for (const surface of ordered) {
    const term = candidateTerm(surface)
    const bare = term.replaceAll('"', '')
    if (bare.length < 4 || stoplist.has(bare.toLowerCase())) {
      dropped.push(term)
      continue
    }
    const key = bare.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (terms.length < limit) terms.push(term)
    else dropped.push(term)
  }

  return { dropped, terms }
}
