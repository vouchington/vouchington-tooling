import type { ComponentRegistry } from './component-registry.mts'
import type { ContractSchemaNode } from './contract-schema-types.mts'

const ERROR_BODY_NODE = {
  type: 'object',
  properties: {
    message: { required: true, schema: { type: 'string' } },
    code: { required: false, schema: { type: 'string' } },
    request_id: { required: false, schema: { type: 'string' } },
    stack: { required: false, schema: { type: 'string' } },
  },
  additionalProperties: false,
} as const satisfies ContractSchemaNode

export function registerOpenApiErrorResponse(registry: ComponentRegistry): void {
  registry.register('openapi-error-response', { ErrorBody: ERROR_BODY_NODE })
}
