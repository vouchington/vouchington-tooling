import { readFileSync } from 'node:fs'
import { dirname, join, normalize, relative, sep } from 'node:path'

import type { SharedContext } from '../shared-context/index.mts'
import { canonicalFragmentTargets, canonicalWholeFileTargets } from './child-links.mts'

export interface CanonicalChildLinksOptions {
  /** Repo-relative POSIX paths of the split Markdown indexes to check. */
  parents: readonly string[]
}

function repoRelativePath(repoRoot: string, rootFile: string, target: string): string {
  return relative(repoRoot, normalize(join(repoRoot, dirname(rootFile), target)))
    .split(sep)
    .join('/')
}

/**
 * In every tracked split index listed in `parents`, a child linked with a `#fragment` must also
 * have a whole-file link so composition includes it.
 */
export function checkCanonicalChildLinks(
  ctx: SharedContext,
  options: CanonicalChildLinksOptions,
): { errors: string[] } {
  const errors: string[] = []
  for (const rootFile of options.parents) {
    if (!ctx.trackedFileSet.has(rootFile)) continue
    const rootContent =
      ctx.readTrackedFile?.(rootFile) ?? readFileSync(join(ctx.repoRoot, rootFile), 'utf8')
    const wholeFileTargets = new Set(
      [...canonicalWholeFileTargets(rootContent)].map((target) =>
        repoRelativePath(ctx.repoRoot, rootFile, target),
      ),
    )
    for (const target of canonicalFragmentTargets(rootContent)) {
      if (wholeFileTargets.has(repoRelativePath(ctx.repoRoot, rootFile, target))) continue
      errors.push(
        `::error file=${rootFile}::${rootFile}: canonical child ${target} is linked only by a fragment; add a whole-file Markdown link for composition`,
      )
    }
  }
  return { errors }
}
