import ts from '../contract-schema/typescript-api.mts'

import { extractContractSchema } from '../contract-schema/index.mts'
import {
  markBufferedRequestRouteUnavailable,
  registerRequestContract,
  registerRequestRouteContract,
  type DiscoverApiRequestContractsOptions,
} from './request-contract-lenient.mts'
import {
  enclosingRequestBodyCast,
  isContextRequestBufferCall,
  isContextRequestJsonCall,
} from './request-contract-route-analysis.mts'
import { sourceLocation } from './response-contract-registration.mts'
import {
  enclosingRouteBinding,
  requestedKeyForBinding,
  type HandlerBindings,
} from './response-contract-route-analysis.mts'
import type { BackendRequestContract } from './request-contract-types.mts'

/**
 * Resolves the effective static type of a body-read call, or `undefined` when `call` isn't a
 * body-read pattern this harvester recognizes at all (most call expressions in a route file
 * aren't). `parseJsonBody<T>(ctx)`'s own call-expression type is `Promise<T>` (or `Promise<unknown>`
 * with no type argument) — `extractContractSchema` auto-unwraps the `Promise` either way, so no
 * special-casing is needed. `ctx.request.json(...)` has no such generic in practice; its effective
 * type comes from the enclosing `as T` cast, when one exists (`enclosingRequestBodyCast`) — absent
 * one, the call's own type is `Promise<unknown>`, which resolves to an honest `{type:'unknown'}`
 * rather than a failure (see `enclosingRequestBodyCast`'s docstring).
 */
function resolveRequestBodyType(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): ts.Type | undefined {
  if (ts.isIdentifier(call.expression) && call.expression.text === 'parseJsonBody') {
    return checker.getTypeAtLocation(call)
  }
  if (!isContextRequestJsonCall(call.expression)) return undefined
  const cast = enclosingRequestBodyCast(call)
  return checker.getTypeAtLocation(cast ?? call)
}

/**
 * Phase 2 (implicit harvest) dispatch for one call expression. Requests have no `#variant` escape
 * hatch, so precedence is stricter than the response side's: an explicit `apiRequest`/
 * `apiNoRequestBody` marker registered in Phase 1 (`markerKeys`) always wins outright — a harvest
 * never even attempts to register over one. A second implicit body-read for a route an earlier
 * implicit call already covered attempts registration but swallows any failure (extraction error
 * or hash mismatch), keeping the first-registered contract untouched — mirrors
 * `response-contract-implicit.mts`'s secondary-variant handling, minus the variant key (requests
 * get at most one contract per route). A `ctx.request.buffer(...)` read always overrides,
 * regardless of visit order or what's already registered, mirroring the response side's own
 * buffer-detection override.
 */
export function discoverImplicitRequestContract(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  contracts: Map<string, BackendRequestContract>,
  markerKeys: ReadonlySet<string>,
  handlerBindings: HandlerBindings,
  requestedKeys: ReadonlySet<string> | undefined,
  options: DiscoverApiRequestContractsOptions | undefined,
): void {
  const binding = enclosingRouteBinding(call, checker, handlerBindings)
  if (!binding) return
  const key = requestedKeyForBinding(binding, requestedKeys)
  if (!key) return

  if (isContextRequestBufferCall(call.expression)) {
    markBufferedRequestRouteUnavailable(contracts, key, binding, sourceLocation(sourceFile, call))
    return
  }

  if (markerKeys.has(key)) return // An explicit Phase 1 marker always wins; never harvest over it.

  const bodyType = resolveRequestBodyType(call, checker)
  if (!bodyType) return

  const location = sourceLocation(sourceFile, call)
  const extract = () => extractContractSchema(bodyType, checker, location, options)

  if (!contracts.has(key)) {
    registerRequestRouteContract(contracts, key, binding, location, extract, options)
    return
  }

  // A second body-read call for a route an earlier implicit harvest already covered — attempt
  // registration but silently drop it on a hash-mismatch collision, keeping the
  // first-registered contract. Anything else (a type-checker crash, an AST invariant
  // violation) is unexpected and worth surfacing rather than swallowing.
  try {
    const extracted = extract()
    registerRequestContract(contracts, key, { ...extracted, ...binding })
  } catch (error) {
    if (error instanceof Error && !error.message.includes('resolves to multiple')) {
      console.warn(`Second body-read extraction for "${key}" failed:`, error)
    }
  }
}
