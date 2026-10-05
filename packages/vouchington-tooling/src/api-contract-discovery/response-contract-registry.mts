import ts from '../contract-schema/typescript-api.mts'
import { registerPlatformCompilerLibraries } from './protocol-platform-callbacks.mts'
import { registerSseNodeConstructorContext } from './protocol-sse-node-constructor.mts'
import { protocolBindingRequested, requestedProtocolKey } from './protocol-requested-keys.mts'
import { discoverProtocolContracts } from './protocol-contract-registry.mts'
import { discoverImplicitContract } from './response-contract-implicit.mts'
import { ambiguousRoutesForCall } from './response-contract-attribution.mts'
import { sortAttributionFacts } from './response-contract-attribution-facts.mts'
import { implicitResponseCallLabel } from './response-contract-call-classification.mts'
import { collectHandlerBindings } from './response-contract-handler-bindings.mts'
import {
  registerRouteContract,
  type AmbiguousAttributionFact,
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
  enclosingRouteBinding,
  isContextMethod,
  responseMarker,
  type AmbiguousHandlerBindings,
  visit,
} from './response-contract-route-analysis.mts'
import { resolveEmissionStatus } from './response-contract-status.mts'
import type { BackendResponseContract } from './response-contract-types.mts'
import { createProgramHttpContextValueResolver } from './protocol-http-context-values.mts'

export type { BackendResponseContract, DiscoverApiResponseContractsOptions }

export function discoverApiResponseContracts(
  program: ts.Program,
  sourceFiles: readonly ts.SourceFile[],
  requestedKeys?: ReadonlySet<string>,
  options?: DiscoverApiResponseContractsOptions,
): Record<string, BackendResponseContract> {
  registerPlatformCompilerLibraries(program)
  registerSseNodeConstructorContext(program)
  const checker = program.getTypeChecker()
  const httpValues = createProgramHttpContextValueResolver(program)
  const contracts = new Map<string, BackendResponseContract>()
  const ambiguousBindings: AmbiguousHandlerBindings | undefined = options?.onAmbiguousAttribution
    ? new Map()
    : undefined
  const handlerBindings = collectHandlerBindings(sourceFiles, checker, ambiguousBindings)
  const attributionFacts: AmbiguousAttributionFact[] = []
  const protocolContracts = new Map<string, BackendResponseContract>()
  const protocolEmissions = discoverProtocolContracts(
    sourceFiles,
    checker,
    handlerBindings,
    protocolContracts,
    options,
    requestedKeys,
    httpValues,
  )
  for (const [key, contract] of protocolContracts) {
    const requestedKey = requestedProtocolKey(key, contract, requestedKeys)
    if (requestedKey) contracts.set(requestedKey, contract)
  }

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
      if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return
      const callLabel = ts.isCallExpression(node) ? implicitResponseCallLabel(node) : undefined
      if (options?.onAmbiguousAttribution && ts.isCallExpression(node)) {
        const attributionLabel = implicitResponseCallLabel(node, true, checker)
        const routes = attributionLabel
          ? ambiguousBindings &&
            ambiguousRoutesForCall(node, checker, handlerBindings, ambiguousBindings)
          : undefined
        const requestedRoute =
          !requestedKeys ||
          routes?.some((route) => {
            const separator = route.indexOf(':')
            return (
              separator > 0 &&
              protocolBindingRequested(
                { method: route.slice(0, separator), routeTemplate: route.slice(separator + 1) },
                requestedKeys,
              )
            )
          })
        if (attributionLabel && routes && requestedRoute) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          attributionFacts.push({
            sourceLocation: `${sourceLocation(sourceFile, node)}:${position.line + 1}:${position.character + 1}`,
            label: attributionLabel,
            routes: [...routes],
          })
        }
      }
      if (
        ts.isCallExpression(node) &&
        (responseMarker(node.expression) || protocolEmissions.has(node))
      )
        return
      discoverImplicitContract(
        node,
        checker,
        sourceFile,
        contracts,
        handlerBindings,
        callLabel,
        requestedKeys,
        options,
        httpValues,
      )
    })
  }

  const result = Object.fromEntries(
    [...contracts.entries()].toSorted(([left], [right]) => left.localeCompare(right)),
  )
  if (options?.onAmbiguousAttribution) {
    for (const fact of sortAttributionFacts(attributionFacts)) options.onAmbiguousAttribution(fact)
  }
  return result
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
