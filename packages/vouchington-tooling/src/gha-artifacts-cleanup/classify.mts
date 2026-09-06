import picomatch from 'picomatch'

export type ArtifactClassification = 'keep' | 'delete'

export type ArtifactClassifier = {
  classify: (name: string) => ArtifactClassification
  isExplicitlyClassified: (name: string) => boolean
}

export type ArtifactPatterns = {
  keepPatterns: readonly string[]
  deletePatterns: readonly string[]
}

function matcher(patterns: readonly string[]): (name: string) => boolean {
  if (patterns.length === 0) return () => false
  return picomatch([...patterns])
}

export function createArtifactClassifier(patterns: ArtifactPatterns): ArtifactClassifier {
  const isKeep = matcher(patterns.keepPatterns)
  const isDelete = matcher(patterns.deletePatterns)
  return {
    classify: (name) => (isKeep(name) ? 'keep' : 'delete'),
    isExplicitlyClassified: (name) => isKeep(name) || isDelete(name),
  }
}

export function parseArtifactPatternsJson(value: unknown): {
  keepPatterns: string[]
  deletePatterns: string[]
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('patterns file must be a JSON object with keep and delete arrays')
  }
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- establish a record view after validating the untrusted patterns object
  const record = value as Record<string, unknown>
  return {
    keepPatterns: stringArray(record.keep, 'keep'),
    deletePatterns: stringArray(record.delete, 'delete'),
  }
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`patterns file ${field} must be an array of strings`)
  }
  return value
}
