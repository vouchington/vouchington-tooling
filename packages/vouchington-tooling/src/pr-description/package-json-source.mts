import type { RunTextCommand } from '../gh-cli/index.mts'
import type { PackageJsonReader } from './pr-description-types.mts'

function memoizedResolver<T>(resolve: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined
  return () => (cached ??= resolve())
}

/**
 * Reads `package.json` from the local git merge-base against `baseRef` (default `'origin/main'`)
 * for `'base'` and from `HEAD` for `'head'`. Missing files or git failures resolve to `undefined`.
 */
export function createLocalPackageJsonReader(
  runGit: RunTextCommand,
  baseRef = 'origin/main',
): PackageJsonReader {
  const resolveMergeBase = memoizedResolver(async () =>
    (await runGit(['merge-base', baseRef, 'HEAD'])).trim(),
  )
  return async (path, side) => {
    try {
      const ref = side === 'head' ? 'HEAD' : await resolveMergeBase()
      return await runGit(['show', `${ref}:${path}`])
    } catch {
      return undefined
    }
  }
}

type CompareResponse = { merge_base_commit?: { sha?: string } }

/**
 * Reads `package.json` through the GitHub contents API using the compare API's
 * `merge_base_commit.sha` for `'base'` and `headRefOid` for `'head'`.
 */
export function createGhPackageJsonReader(
  runGh: RunTextCommand,
  repo: string,
  baseRefOid: string,
  headRefOid: string,
): PackageJsonReader {
  const resolveMergeBase = memoizedResolver(async () => {
    const json = await runGh(['api', `repos/${repo}/compare/${baseRefOid}...${headRefOid}`])
    const sha = (JSON.parse(json) as CompareResponse).merge_base_commit?.sha
    if (sha === undefined) throw new Error('compare response missing merge_base_commit.sha')
    return sha
  })
  return async (path, side) => {
    try {
      const ref = side === 'head' ? headRefOid : await resolveMergeBase()
      return await runGh([
        'api',
        '-X',
        'GET',
        `repos/${repo}/contents/${path}`,
        '-f',
        `ref=${ref}`,
        '-H',
        'Accept: application/vnd.github.raw',
      ])
    } catch {
      return undefined
    }
  }
}
