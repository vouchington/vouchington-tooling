import ts from '../contract-schema/typescript-api.mts'

import { extractContractSchema } from '../contract-schema/index.mts'
import { isInErrorBranch } from './response-contract-error-branch.mts'
import {
  containsResponseMarker,
  noContentContract,
  registerContract,
  responseBodyExpression,
  sourceLocation,
} from './response-contract-registration.mts'
import { streamingTextMediaType } from './response-contract-media.mts'
import { nextImplicitVariantKey } from './response-contract-implicit-variants.mts'
import type { ImplicitResponseCallLabel } from './response-contract-call-classification.mts'
import {
  markBufferedRouteUnavailable,
  registerRouteContract,
  type DiscoverApiResponseContractsOptions,
} from './response-contract-lenient.mts'
import {
  enclosingRouteBinding,
  isContextMethod,
  requestedKeyForBinding,
  responseMarker,
  type HandlerBindings,
} from './response-contract-route-analysis.mts'
import { resolveEmissionStatus } from './response-contract-status.mts'
import {
  opaqueHttpResponse,
  unsupportedContextResponse,
  supportedResponseContext,
} from './protocol-http-association.mts'
import { contextResponseMethod } from './protocol-http-context.mts'
import {
  taintRouteKeys,
  markRouteTaint,
  isSseSetter,
  taintContextConstruction,
} from './protocol-http-implicit-taint.mts'
import type { BackendResponseContract } from './response-contract-types.mts'
import type { createHttpContextValueResolver } from './protocol-http-context-values.mts'

export function discoverImplicitContract(
  call: ts.CallExpression | ts.NewExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  contracts: Map<string, BackendResponseContract>,
  handlerBindings: HandlerBindings,
  callLabel: ImplicitResponseCallLabel | undefined,
  requestedKeys: ReadonlySet<string> | undefined,
  options: DiscoverApiResponseContractsOptions | undefined,
  httpValues?: ReturnType<typeof createHttpContextValueResolver>,
): void {
  if (ts.isNewExpression(call))
    return taintContextConstruction(call, checker, contracts, handlerBindings, requestedKeys)
  const opaqueResponse = opaqueHttpResponse(call, checker, undefined, httpValues)
  const binding = enclosingRouteBinding(call, checker, handlerBindings, !opaqueResponse)
  if (!binding) return
  const key = requestedKeyForBinding(binding, requestedKeys)
  const taintKeys = taintRouteKeys(contracts, binding, key)
  if (!taintKeys.length) return

  const context = supportedResponseContext(call, checker)
  const bracketResponse =
    context &&
    (ts.isElementAccessExpression(call.expression) ||
      (ts.isPropertyAccessExpression(call.expression) &&
        ts.isElementAccessExpression(call.expression.expression))) &&
    contextResponseMethod(call.expression, context, checker)
  const mutableResponse = unsupportedContextResponse(call, checker)
  const sseSetter = isSseSetter(contracts, binding, bracketResponse || undefined)
  if (
    opaqueResponse ||
    mutableResponse ||
    (bracketResponse && !sseSetter && !containsResponseMarker(call))
  ) {
    markRouteTaint(
      contracts,
      taintKeys,
      binding,
      sourceLocation(sourceFile, call),
      !!mutableResponse &&
        !!context &&
        !!contextResponseMethod(call.expression, context, checker, true),
    )
    return
  }
  if (!key) return
  if (context && httpValues?.accountedSse(call, context, call, call)) return

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

    // Keep primary extraction failures unavailable in both full and subset discovery.
    if (requestedKeys || !contracts.has(key)) {
      registerRouteContract(contracts, key, binding, location, emission, extract, options)
      return
    }

    // Preserve every additional unmarked body under a deterministic variant key, including
    // unavailable secondary extractions. Route grouping merges these without hiding a branch.
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

  if (callLabel === 'ctx.response.xml()') {
    if (requestedKeys && contracts.has(key)) return
    const body = call.arguments[0]!
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

  // Empty branches must not hide any unmarked buffer or pipeline body.
  if (
    callLabel === 'ctx.response.buffer()' ||
    (callLabel === 'ctx.pipeline()' && !body && !containsResponseMarker(call))
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
    callLabel === 'ctx.response.empty()'
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
