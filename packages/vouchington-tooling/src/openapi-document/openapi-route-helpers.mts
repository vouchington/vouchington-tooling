import { STATUS_CODES } from 'node:http'

import { routeShape } from './operation-types.mts'
import type { OpenApiParameter, OpenApiResponseOrRef } from './openapi-types.mts'

export function canonicalTemplatesByShape(routeTemplates: readonly string[]): Map<string, string> {
  const canonical = new Map<string, string>()
  for (const routeTemplate of routeTemplates) {
    const shape = routeShape(routeTemplate)
    const existing = canonical.get(shape)
    if (!existing || routeTemplate.localeCompare(existing) < 0) canonical.set(shape, routeTemplate)
  }
  return canonical
}

export function pathParameters(routeTemplate: string): OpenApiParameter[] {
  return [...routeTemplate.matchAll(/:(\w+)/g)].map((match) => ({
    name: match[1]!,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))
}

export function operationId(method: string, routeTemplate: string): string {
  const path = routeTemplate.replace(/^\//, '').replace(/[/:]+/g, '_')
  return `${method.toLowerCase()}_${path}`
}

export function catalogResponse(
  kind: 'ordinary' | 'sse' | 'error-only' | 'fixed-no-content',
  fixedStatus?: number,
): {
  responses: Record<number, OpenApiResponseOrRef>
  unavailable: boolean
  unavailableReason?: string
} {
  if (kind === 'fixed-no-content') {
    if (fixedStatus === undefined) throw new Error('fixed-no-content route requires a status')
    return {
      responses: {
        [fixedStatus]: { description: STATUS_CODES[fixedStatus] ?? 'Response' },
      },
      unavailable: false,
    }
  }
  if (kind === 'error-only') {
    const reason = 'registered route has no success response'
    return {
      responses: { 405: { $ref: '#/components/responses/Error' } },
      unavailable: true,
      unavailableReason: reason,
    }
  }
  const reason =
    kind === 'sse'
      ? 'SSE event payload sequence is not statically extracted'
      : 'registered route has no statically recognized response emission'
  return {
    responses:
      kind === 'sse'
        ? {
            200: {
              description: 'OK',
              content: { 'text/event-stream': { schema: {} } },
              'x-schema-unavailable': true,
              'x-schema-unavailable-reason': reason,
            },
          }
        : {},
    unavailable: true,
    unavailableReason: reason,
  }
}
