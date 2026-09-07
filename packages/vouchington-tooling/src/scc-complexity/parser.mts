import type { SccComplexityValue } from './types.mts'
import { canonicalRepoPath } from './paths.mts'

interface SccFile {
  Location?: unknown
  Complexity?: unknown
}

interface SccLanguage {
  Files?: unknown
}

export function parseSccComplexityValues(
  json: string,
  trackedFileSet: ReadonlySet<string>,
  repoRoot?: string,
): SccComplexityValue[] {
  const parsed = JSON.parse(json) as unknown
  if (!Array.isArray(parsed)) throw new Error('scc JSON output must be an array')
  const values: SccComplexityValue[] = []
  for (const language of parsed as SccLanguage[]) {
    if (!Array.isArray(language.Files)) continue
    for (const file of language.Files as SccFile[]) {
      if (typeof file.Location !== 'string') continue
      const location = repoRoot ? canonicalRepoPath(repoRoot, file.Location) : file.Location
      if (!trackedFileSet.has(location)) continue
      if (typeof file.Complexity === 'number')
        values.push({ complexity: file.Complexity, file: location })
    }
  }
  return values.toSorted((a, b) => b.complexity - a.complexity || a.file.localeCompare(b.file))
}
