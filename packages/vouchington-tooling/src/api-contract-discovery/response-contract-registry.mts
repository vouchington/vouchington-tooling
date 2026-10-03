import ts from '../contract-schema/typescript-api.mts'
import { discoverProtocolContracts } from './protocol-contract-registry.mts'

import { discoverImplicitContract } from './response-contract-implicit.mts'
import {
  registerRouteContract,
  type DiscoverApiResponseContractsOptions,
} from './response-contract-lenient.mts'
import {
  binaryContentContract,
  contractError,
  extractBodyContract,
  noContentContract,
  sourceLocation,
} from './response-contract-registration.mts'
import {
  collectHandlerBindings,
  enclosingRouteBinding,
  isContextMethod,
  responseMarker,
  visit,
} from './response-contract-route-analysis.mts'
import { resolveEmissionStatus } from './response-contract-status.mts'
import type { BackendResponseContract } from './response-contract-types.mts'

export type { BackendResponseContract } from './response-contract-types.mts'
export type { DiscoverApiResponseContractsOptions } from './response-contract-lenient.mts'

export function discoverApiResponseContracts(
  program: ts.Program,
  sourceFiles: readonly ts.SourceFile[],
  requestedKeys?: ReadonlySet<string>,
  options?: DiscoverApiResponseContractsOptions,
): Record<string, BackendResponseContract> {
  const checker = program.getTypeChecker()
  const contracts = new Map<string, BackendResponseContract>()
  const handlerBindings = collectHandlerBindings(sourceFiles, checker)
  const protocolEmissions = discoverProtocolContracts(
    sourceFiles,
    checker,
    handlerBindings,
    contracts,
    options,
  )

  for (const sourceFile of sourceFiles) {
    visit(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return
      const marker = responseMarker(node.expression)
      if (!marker) return
      const keyNode = node.arguments[0]
      if (!keyNode || !ts.isStringLiteral(keyNode)) {
        throw contractError(sourceFile, node, `${marker} requires a literal contract key`)
      }
      const binding = enclosingRouteBinding(node, checker, handlerBindings)
      if (!binding)
        throw contractError(sourceFile, node, `${marker} must be inside an app.route handler`)
      const expectedPrefix = `${binding.method}:${binding.routeTemplate}`
      if (keyNode.text !== expectedPrefix && !keyNode.text.startsWith(`${expectedPrefix}#`)) {
        throw contractError(
          sourceFile,
          keyNode,
          `Contract key "${keyNode.text}" does not match enclosing route ${expectedPrefix}`,
        )
      }
      const location = sourceLocation(sourceFile, node)
      const responseEmission = enclosingResponseEmission(node) ?? node
      const status = resolveEmissionStatus(responseEmission)
      const rawMediaType = rawResponseMediaType(marker, node, sourceFile)
      registerRouteContract(
        contracts,
        keyNode.text,
        binding,
        location,
        {
          bodyKind: marker === 'apiNoContent' ? 'none' : 'content',
          ...(marker === 'apiResponse'
            ? { mediaType: 'application/json', mediaTypeKnowledge: 'known' as const }
            : rawMediaType
              ? { mediaType: rawMediaType, mediaTypeKnowledge: 'known' as const }
              : { mediaTypeKnowledge: 'none' as const }),
          ...status,
        },
        () =>
          marker === 'apiNoContent'
            ? noContentContract(location)
            : marker === 'apiOpenApiRawResponse'
              ? binaryContentContract(location)
              : extractBodyContract(node, checker, sourceFile, location, options),
        options,
      )
    })
  }

  for (const sourceFile of sourceFiles) {
    visit(sourceFile, (node) => {
      if (
        !ts.isCallExpression(node) ||
        responseMarker(node.expression) ||
        protocolEmissions.has(node)
      )
        return
      discoverImplicitContract(
        node,
        checker,
        sourceFile,
        contracts,
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

function rawResponseMediaType(
  marker: ReturnType<typeof responseMarker>,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (marker !== 'apiOpenApiRawResponse') return undefined
  const mediaType = node.arguments[1]
  if (!mediaType || !ts.isStringLiteral(mediaType)) {
    throw contractError(sourceFile, node, 'apiOpenApiRawResponse requires a literal media type')
  }
  return mediaType.text
}

export function enclosingResponseEmission(call: ts.CallExpression): ts.CallExpression | undefined {
  let current: ts.Node | undefined = call.parent
  while (current && !ts.isStatement(current)) {
    if (
      ts.isCallExpression(current) &&
      (isContextMethod(current.expression, 'json') ||
        isContextMethod(current.expression, 'pipeline'))
    )
      return current
    current = current.parent
  }
  return undefined
}
