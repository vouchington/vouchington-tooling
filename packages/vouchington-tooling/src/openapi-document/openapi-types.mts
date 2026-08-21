export type OpenApiSchema = {
  $ref?: string
  type?: 'null' | 'boolean' | 'integer' | 'number' | 'string' | 'array' | 'object'
  format?: 'uri' | 'uuid'
  const?: boolean | number | string
  enum?: (boolean | number | string)[]
  items?: OpenApiSchema | false
  prefixItems?: OpenApiSchema[]
  minItems?: number
  maxItems?: number
  minimum?: number
  maximum?: number
  pattern?: string
  default?: boolean | number | string
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  additionalProperties?: false | OpenApiSchema
  anyOf?: OpenApiSchema[]
  allOf?: OpenApiSchema[]
}

export type OpenApiParameter =
  | { name: string; in: 'path'; required: true; schema: { type: 'string' } }
  | {
      name: string
      in: 'query'
      required: false
      description?: string
      style?: 'form'
      explode?: false
      schema: OpenApiSchema
    }

export type OpenApiResponse = {
  description: string
  content?: Record<string, { schema: OpenApiSchema }>
  'x-schema-unavailable'?: true
  'x-schema-unavailable-reason'?: string
}

export type OpenApiResponseOrRef = OpenApiResponse | { $ref: string }

export type OpenApiRequestBody = {
  content: { 'application/json': { schema: OpenApiSchema } }
  'x-request-schema-unavailable'?: true
  'x-request-schema-unavailable-reason'?: string
}

export type OpenApiOperation = {
  operationId: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses: Record<string, OpenApiResponseOrRef>
  'x-schema-unavailable'?: true
  'x-schema-unavailable-reason'?: string
}

export type OpenApiDocument = {
  openapi: '3.1.0'
  info: { title: string; version: string }
  paths: Record<string, Record<string, OpenApiOperation>>
  components: {
    schemas: Record<string, OpenApiSchema>
    responses: { Error: OpenApiResponse }
  }
  'x-unavailable-routes': string[]
  'x-unavailable-request-routes': string[]
}
