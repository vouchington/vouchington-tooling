import ts from '../contract-schema/typescript-api.mts'

import { extractContractSchema } from '../contract-schema/index.mts'
import {
  containsResponseMarker,
  noContentContract,
  registerContract,
  responseBodyExpression,
  sourceLocation,
} from './response-contract-registration.mts'
import { isInErrorBranch } from './response-contract-error-branch.mts'
import { isXmlResponseCall, streamingTextMediaType } from './response-contract-media.mts'
import {
  markBufferedRouteUnavailable,
  registerRouteContract,
  type DiscoverApiResponseContractsOptions,
} from './response-contract-lenient.mts'
import {
  enclosingRouteBinding,
  isContextMethod,
  isContextResponseBufferCall,
  isContextResponseEmptyCall,
  requestedKeyForBinding,
  responseMarker,
  type HandlerBindings,
} from './response-contract-route-analysis.mts'
import { resolveEmissionStatus } from './response-contract-status.mts'
import { unsupportedContextResponse } from './protocol-http-emission.mts'
import type { BackendResponseContract } from './response-contract-types.mts'

export function discoverImplicitContract(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  contracts: Map<string, BackendResponseContract>,
  handlerBindings: HandlerBindings,
  requestedKeys: ReadonlySet<string> | undefined,
  options: DiscoverApiResponseContractsOptions | undefined,
): void {
  const binding = enclosingRouteBinding(call, checker, handlerBindings)
  if (!binding) return
  const key = requestedKeyForBinding(binding, requestedKeys)
  if (!key) return

  if (unsupportedContextResponse(call, checker)) {
    markBufferedRouteUnavailable(contracts, key, binding, sourceLocation(sourceFile, call))
    return
  }

  const body = responseBodyExpression(call)
  if (body) {
    if (ts.isCallExpression(body) && responseMarker(body.expression)) return
    if (requestedKeys && contracts.has(key)) return
    if (isInErrorBranch(call)) return
    const location = sourceLocation(sourceFile, call)
    const extract = () =>
      extractContractSchema(checker.getTypeAtLocation(body), checker, location, options)
    const status = resolveEmissionStatus(call)
    const emission = {
      bodyKind: 'content' as const,
      mediaType: 'application/json',
      mediaTypeKnowledge: 'known' as const,
      ...status,
    }

    // Primary body (bare key, or requested key in subset mode) uses the lenient path, so a
    // genuine single-variant route still reports a real `unavailableReason` on failure.
    if (requestedKeys || !contracts.has(key)) {
      registerRouteContract(contracts, key, binding, location, emission, extract, options)
      return
    }

    // Full-scope discovery: a route can emit more than one distinct unmarked success body across
    // branches (e.g. a webhook's `{received}` vs `{ignored}`); register each under its own key —
    // `groupContractsByRoute` merges by method/routeTemplate, not this key. This route already has
    // a primary contract, so retain this one under a deterministic variant key. A failed secondary
    // extraction is registered as unavailable so the operation never silently omits a real branch.
    registerRouteContract(
      contracts,
      nextImplicitVariantKey(contracts, key),
      binding,
      location,
      emission,
      extract,
      options,
    )
    return
  }

  if (isXmlResponseCall(call)) {
    if (requestedKeys && contracts.has(key)) return
    const body = call.arguments[0]
    if (!body) return
    const location = sourceLocation(sourceFile, call)
    registerRouteContract(
      contracts,
      contracts.has(key) ? nextImplicitVariantKey(contracts, key) : key,
      binding,
      location,
      {
        bodyKind: 'content',
        mediaType: 'application/xml',
        mediaTypeKnowledge: 'known',
        ...resolveEmissionStatus(call),
      },
      () => extractContractSchema(checker.getTypeAtLocation(body), checker, location, options),
      options,
    )
    return
  }

  const streamedTextMediaType = isContextMethod(call.expression, 'pipeline')
    ? streamingTextMediaType(call)
    : undefined
  if (streamedTextMediaType) {
    const location = sourceLocation(sourceFile, call)
    registerRouteContract(
      contracts,
      contracts.has(key) ? nextImplicitVariantKey(contracts, key) : key,
      binding,
      location,
      {
        bodyKind: 'content',
        mediaType: streamedTextMediaType,
        mediaTypeKnowledge: 'known',
        ...resolveEmissionStatus(call),
      },
      () => extractContractSchema(checker.getStringType(), checker, location, options),
      options,
    )
    return
  }

  // Empty and raw branches can coexist; AST order must not let empty hide an unmarked raw body,
  // so every buffer or pipeline without an explicit response marker makes the route unavailable.
  if (
    isContextResponseBufferCall(call.expression) ||
    (isContextMethod(call.expression, 'pipeline') && !body && !containsResponseMarker(call))
  ) {
    markBufferedRouteUnavailable(contracts, key, binding, sourceLocation(sourceFile, call))
    return
  }

  if (requestedKeys && contracts.has(key)) return
  const emissionStatus = resolveEmissionStatus(call)
  const isExplicitNoContentCall =
    (isContextMethod(call.expression, 'setStatus') &&
      call.arguments[0] &&
      ts.isNumericLiteral(call.arguments[0]) &&
      (call.arguments[0].text === '204' || call.arguments[0].text === '205')) ||
    isContextResponseEmptyCall(call.expression)
  if (isExplicitNoContentCall) {
    registerContract(contracts, contracts.has(key) ? nextImplicitVariantKey(contracts, key) : key, {
      ...noContentContract(sourceLocation(sourceFile, call)),
      ...binding,
      bodyKind: 'none',
      mediaTypeKnowledge: 'none',
      ...(emissionStatus.statusCodes ? { statusCodes: emissionStatus.statusCodes } : {}),
      statusKnowledge: emissionStatus.statusKnowledge,
      ...(emissionStatus.unavailableReason
        ? { unavailableReason: emissionStatus.unavailableReason }
        : {}),
    })
  }
}

/** Picks the next deterministic registration key for another implicit response variant. */
function nextImplicitVariantKey(
  contracts: Map<string, BackendResponseContract>,
  key: string,
): string {
  let suffix = 2
  while (contracts.has(`${key}#implicit-${suffix}`)) suffix++
  return `${key}#implicit-${suffix}`
}
