import ts from '../contract-schema/typescript-api.mts'

import { extractContractSchema } from '../contract-schema/index.mts'
import {
  registerRequestRouteContract,
  type DiscoverApiRequestContractsOptions,
} from './request-contract-lenient.mts'
import { discoverImplicitRequestContract } from './request-contract-implicit.mts'
import { requestMarker } from './request-contract-route-analysis.mts'
import type { BackendRequestContract } from './request-contract-types.mts'
import { contractError, sourceLocation } from './response-contract-registration.mts'
import {
  collectHandlerBindings,
  enclosingRouteBinding,
  visit,
} from './response-contract-route-analysis.mts'

export type { BackendRequestContract } from './request-contract-types.mts'
export type { DiscoverApiRequestContractsOptions } from './request-contract-lenient.mts'

/**
 * Two full passes over every route file, mirroring `discoverApiResponseContracts`: Phase 1
 * (explicit request-contract markers) completes for every file before Phase 2
 * (implicit harvest of `parseJsonBody`/`ctx.request.json(...) as T`/`ctx.request.buffer(...)`)
 * begins, so a marker anywhere always wins over a harvest anywhere regardless of visit order.
 * `markerKeys` records every key an explicit marker claimed (a body, or a deliberate
 * `apiNoRequestBody` suppression) so Phase 2 knows to never harvest over it.
 */
export function discoverApiRequestContracts(
  program: ts.Program,
  sourceFiles: readonly ts.SourceFile[],
  requestedKeys?: ReadonlySet<string>,
  options?: DiscoverApiRequestContractsOptions,
): Record<string, BackendRequestContract> {
  const checker = program.getTypeChecker()
  const contracts = new Map<string, BackendRequestContract>()
  const markerKeys = new Set<string>()
  const handlerBindings = collectHandlerBindings(sourceFiles, checker)

  for (const sourceFile of sourceFiles) {
    visit(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return
      const marker = requestMarker(node.expression)
      if (!marker) return
      const keyNode = node.arguments[0]
      if (!keyNode || !ts.isStringLiteral(keyNode)) {
        throw contractError(sourceFile, node, `${marker} requires a literal contract key`)
      }
      const binding = enclosingRouteBinding(node, checker, handlerBindings)
      if (!binding)
        throw contractError(sourceFile, node, `${marker} must be inside an app.route handler`)
      const expectedKey = `${binding.method}:${binding.routeTemplate}`
      if (keyNode.text !== expectedKey) {
        // Requests have no `#variant` escape hatch (unlike responses) — the key must match exactly.
        throw contractError(
          sourceFile,
          keyNode,
          `Contract key "${keyNode.text}" does not match enclosing route ${expectedKey}`,
        )
      }
      markerKeys.add(keyNode.text)
      if (marker === 'apiNoRequestBody') return // Deliberate suppression: no contract, harvest skips this key.
      const bodyNode = node.arguments[1]
      const typeNode = node.typeArguments?.[1]
      if (marker === 'apiRequest' && !bodyNode)
        throw contractError(sourceFile, node, 'apiRequest requires a request body')
      if (marker === 'apiRequestContract' && !typeNode)
        throw contractError(sourceFile, node, 'apiRequestContract requires a request body type')
      const location = sourceLocation(sourceFile, node)
      registerRequestRouteContract(
        contracts,
        keyNode.text,
        binding,
        location,
        () =>
          extractContractSchema(
            typeNode ? checker.getTypeFromTypeNode(typeNode) : checker.getTypeAtLocation(bodyNode!),
            checker,
            location,
            options,
          ),
        options,
      )
    })
  }

  for (const sourceFile of sourceFiles) {
    visit(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || requestMarker(node.expression)) return
      discoverImplicitRequestContract(
        node,
        checker,
        sourceFile,
        contracts,
        markerKeys,
        handlerBindings,
        requestedKeys,
        options,
      )
    })
  }

  return Object.fromEntries(
    [...contracts.entries()].toSorted(([left], [right]) => left.localeCompare(right)),
  )
}
