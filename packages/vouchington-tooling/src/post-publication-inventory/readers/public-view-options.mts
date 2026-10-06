import type { ReaderSqlTemplateOptions } from './sql-template.mts'

export interface ReaderPublicViewOptions {
  readonly sql: ReaderSqlTemplateOptions
  readonly sourceRelation: string
  readonly eligibilityRelation: string
  readonly sourceIdColumn: string
  readonly eligibilityIdColumn: string
}
