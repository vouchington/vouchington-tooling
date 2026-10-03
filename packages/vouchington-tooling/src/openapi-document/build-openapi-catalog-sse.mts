import type { buildOperationResponse } from './build-openapi-response.mts'
import type { RegisteredRoute, ResponseContract } from './operation-types.mts'
import { catalogResponse } from './openapi-route-helpers.mts'

/** Keeps a cataloged stream unavailable until its extracted variants describe SSE. */
export function retainCatalogSseResponse(
  kind: RegisteredRoute['kind'] | undefined,
  variants: readonly ResponseContract[],
  rendered: ReturnType<typeof buildOperationResponse>,
): ReturnType<typeof buildOperationResponse> {
  if (
    kind !== 'sse' ||
    variants.some(
      (variant) =>
        variant.mediaType === 'text/event-stream' &&
        variant.mediaTypeKnowledge !== 'unknown' &&
        variant.bodyKind !== 'none',
    )
  )
    return rendered
  const reason = [rendered.unavailableReason, catalogResponse('sse').unavailableReason!]
    .filter(Boolean)
    .join('; ')
  const existing = rendered.responses[200]
  return {
    responses: {
      ...rendered.responses,
      200: {
        ...existing,
        description: existing?.description ?? 'OK',
        content: { ...existing?.content, 'text/event-stream': { schema: {} } },
        'x-schema-unavailable': true,
        'x-schema-unavailable-reason': reason,
      },
    },
    unavailable: true,
    unavailableReason: reason,
  }
}
