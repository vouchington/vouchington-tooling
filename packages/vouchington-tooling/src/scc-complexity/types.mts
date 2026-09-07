interface SccComplexitySettings {
  limit?: number
  includeExt?: string
  excludeDir?: string
  notMatch?: string
}

export interface SccComplexityScope extends SccComplexitySettings {
  name: string
  includePaths: readonly string[]
}

export interface SccComplexityBaselineEntry {
  scope: string
  file: string
  complexity: number
}

export interface SccComplexityBaseline {
  version: 1
  entries: readonly SccComplexityBaselineEntry[]
}

export interface SccComplexityOptions extends SccComplexitySettings {
  tmpdirPrefix?: string
  command?: string
  scopes?: readonly SccComplexityScope[]
  baseline?: SccComplexityBaseline
}

export interface SccComplexityViolation {
  file: string
  complexity: number
}

export interface SccComplexityValue extends SccComplexityViolation {}
