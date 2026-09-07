import type { SccComplexityValue } from './types.mts'

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
): SccComplexityValue[] {
  const parsed = JSON.parse(json) as unknown
  if (!Array.isArray(parsed)) throw new Error('scc JSON output must be an array')
  const values: SccComplexityValue[] = []
  for (const language of parsed as SccLanguage[]) {
    if (!Array.isArray(language.Files)) continue
    for (const file of language.Files as SccFile[]) {
      if (typeof file.Location !== 'string' || !trackedFileSet.has(file.Location)) continue
      if (typeof file.Complexity === 'number')
        values.push({ complexity: file.Complexity, file: file.Location })
    }
  }
  return values.toSorted((a, b) => b.complexity - a.complexity || a.file.localeCompare(b.file))
}
