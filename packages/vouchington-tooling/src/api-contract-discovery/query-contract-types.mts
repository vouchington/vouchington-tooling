import type { OpenApiQueryContract, OpenApiQueryParameter } from '../openapi-document/index.mts'

export type QueryParameterContract = OpenApiQueryParameter

export type BackendQueryContract = {
  method: string
  routeTemplate: string
  parameters: OpenApiQueryContract
}

export type BackendQueryContractRegistry = Readonly<Record<string, BackendQueryContract>>
