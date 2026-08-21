import type { ContractSchema } from './contract-schema-types.mts'
import type { OpenApiQueryContract } from './query-types.mts'

export type ResponseContract = {
  source: string
  schema: ContractSchema
  method: string
  routeTemplate: string
  statusCodes?: readonly [number, ...number[]]
  statusKnowledge?: 'default' | 'explicit' | 'unknown'
  bodyKind?: 'content' | 'none'
  mediaType?: string
  mediaTypeKnowledge?: 'known' | 'none' | 'unknown'
  unavailableReason?: string
}

export type RequestContract = {
  source: string
  schema: ContractSchema
  method: string
  routeTemplate: string
  unavailableReason?: string
}

export type QueryOperationContract = {
  method: string
  routeTemplate: string
  parameters: OpenApiQueryContract
}

export type RegisteredRoute = {
  method: string
  routeTemplate: string
  kind: 'ordinary' | 'sse' | 'error-only' | 'fixed-no-content'
  fixedStatus?: number
  source: string
}

export function responseStatusCodesForContract(contract: ResponseContract): number[] {
  if (contract.statusKnowledge === 'unknown') return []
  if (contract.statusCodes) return [...new Set(contract.statusCodes)].toSorted((a, b) => a - b)
  const bodyKind = contract.bodyKind ?? (contract.schema.root.type === 'null' ? 'none' : 'content')
  return [bodyKind === 'none' ? 204 : 200]
}

export function routeShape(routeTemplate: string): string {
  return routeTemplate.replace(/:[^/]+/g, ':')
}
