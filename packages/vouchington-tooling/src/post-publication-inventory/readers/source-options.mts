import type { ReaderSqlTemplateOptions } from './sql-template.mts'

/** Repository policy inputs; source analysis retains existing lexical heuristics. */
export interface ReaderSourceAnalysisOptions {
  readonly canonicalImports: ReadonlyMap<string, ReadonlySet<string>>
  readonly sql: ReaderSqlTemplateOptions
  readonly ignoredCall: string
  readonly candidateIdProperty: string
}
