import picomatch from 'picomatch'

import { expandBraceAlternatives } from './globs.mts'

export interface StaleEntries {
  stale: string[]
  unmatched: string[]
}

/**
 * Splits registry entries into fixed paths that no tracked manifest has and wildcard globs that
 * match no tracked manifest. `applies` limits which entries are examined (default all).
 */
export function staleEntries(
  entries: readonly string[],
  manifests: readonly string[],
  applies: (entry: string) => boolean = () => true,
): StaleEntries {
  const stale: string[] = []
  const unmatched: string[] = []
  for (const entry of entries) {
    if (entry.includes('*')) {
      if (applies(entry) && !manifests.some((manifest) => picomatch.isMatch(manifest, entry))) {
        unmatched.push(entry)
      }
      continue
    }
    for (const manifest of expandBraceAlternatives(entry)) {
      if (applies(manifest) && !manifests.includes(manifest)) stale.push(manifest)
    }
  }
  return { stale, unmatched }
}
