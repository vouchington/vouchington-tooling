import type { ContractSchema } from '../openapi-document/contract-schema-types.mts'

export type ExtractedResponseContract = {
  source: string
  schema: ContractSchema
  hash: string
}

export type ContractValidationIssue = {
  path: string
  kind: 'missing-required' | 'unexpected' | 'type'
  message: string
}

export type ExtractContractSchemaOptions = {
  formatAliases?: Readonly<Record<string, 'uuid'>>
  boundedArrayAlias?: string
}
