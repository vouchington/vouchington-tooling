import ts from '../contract-schema/typescript-api.mts'
import { nextProtocolKey } from './protocol-contract-keys.mts'
import { extractContractSchema } from '../contract-schema/index.mts'
import { extractHttpVariants, extractSseEvents } from './protocol-contract-extraction.mts'
import { associateHttpResponse } from './protocol-http-association.mts'
import { protocolBindingRequested } from './protocol-requested-keys.mts'
import { protocolMarker } from './protocol-marker-analysis.mts'
import {
  registerRouteContract,
  type DiscoverApiResponseContractsOptions,
} from './response-contract-lenient.mts'
import { contractError, sourceLocation } from './response-contract-registration.mts'
import {
  enclosingRouteBinding,
  visit,
  type HandlerBindings,
  type RouteBinding,
} from './response-contract-route-analysis.mts'
import type { BackendResponseContract } from './response-contract-types.mts'
import { writeReceiver, sameWriteReceiver, type WriteReceiver } from './protocol-write-receiver.mts'
import { sseEmission } from './protocol-sse-emission.mts'

type PendingHttp = {
  call: ts.CallExpression
  symbol: ts.Symbol
  key: string
  binding: RouteBinding
  variants: Omit<BackendResponseContract, 'method' | 'routeTemplate'>[]
}

export function discoverProtocolContracts(
  sourceFiles: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
  contracts: Map<string, BackendResponseContract>,
  options: DiscoverApiResponseContractsOptions | undefined,
  requestedKeys?: ReadonlySet<string>,
): Set<ts.CallExpression> {
  if (requestedKeys?.size === 0) return new Set()
  const pending: PendingHttp[] = []
  const framedWrites = new Set<ts.CallExpression>()
  const sseBindings = new Map<string, WriteReceiver[]>()
  for (const file of sourceFiles)
    visit(file, (node) => {
      if (!ts.isCallExpression(node)) return
      const marker = protocolMarker(node.expression, checker)
      if (!marker) return
      const binding = enclosingRouteBinding(node, checker, bindings)
      if (!binding) throw contractError(file, node, `${marker} must be inside an app.route handler`)
      if (!protocolBindingRequested(binding, requestedKeys)) return
      const keyNode = node.arguments[0]
      if (!keyNode || !ts.isStringLiteral(keyNode))
        throw contractError(file, node, `${marker} requires a literal contract key`)
      const prefix = `${binding.method}:${binding.routeTemplate}`
      if (keyNode.text !== prefix && !keyNode.text.startsWith(`${prefix}#`))
        throw contractError(
          file,
          keyNode,
          `Contract key "${keyNode.text}" does not match enclosing route ${prefix}`,
        )
      const location = sourceLocation(file, node)
      try {
        const body = node.arguments[1]
        if (!body) throw new Error(`${marker} requires a protocol body`)
        if (marker === 'apiSseFrame') {
          const { write, receiver, status } = sseEmission(node, checker)
          const sseEvents = extractSseEvents(
            checker.getTypeAtLocation(body),
            checker,
            location,
            options,
          )
          contracts.set(nextProtocolKey(contracts, keyNode.text), {
            ...extractContractSchema(checker.getStringType(), checker, location, options),
            ...binding,
            bodyKind: 'content',
            mediaType: 'text/event-stream',
            mediaTypeKnowledge: 'known',
            ...status,
            sseEvents,
          })
          framedWrites.add(write)
          const receivers = sseBindings.get(prefix) ?? []
          receivers.push(receiver)
          sseBindings.set(prefix, receivers)
        } else {
          const declaration = node.parent
          const symbol =
            ts.isVariableDeclaration(declaration) &&
            ts.isIdentifier(declaration.name) &&
            ts.isVariableDeclarationList(declaration.parent) &&
            !!(declaration.parent.flags & ts.NodeFlags.Const)
              ? checker.getSymbolAtLocation(declaration.name)
              : undefined
          if (!symbol) throw new Error('apiOpenApiHttpResponse must bind a response variable')
          pending.push({
            call: node,
            symbol,
            key: keyNode.text,
            binding,
            variants: extractHttpVariants(
              checker.getTypeAtLocation(node),
              checker,
              location,
              options,
            ),
          })
        }
      } catch (error) {
        unavailable(contracts, keyNode.text, binding, location, error, options)
      }
    })
  const covered = new Set<ts.CallExpression>()
  for (const response of pending) {
    let emissions: ReturnType<typeof associateHttpResponse>
    try {
      emissions = associateHttpResponse(response.call, response.symbol, checker)
    } catch (error) {
      unavailable(
        contracts,
        response.key,
        response.binding,
        response.variants[0]!.source,
        error,
        options,
      )
      continue
    }
    const kinds = new Set(emissions.values())
    if (
      !kinds.has('status') ||
      response.variants.some((variant) => !kinds.has(variant.bodyKind!))
    ) {
      unavailable(
        contracts,
        response.key,
        response.binding,
        response.variants[0]!.source,
        new Error('HTTP response variants require associated status and body emissions'),
        options,
      )
      continue
    }
    for (const variant of response.variants)
      contracts.set(nextProtocolKey(contracts, response.key), { ...variant, ...response.binding })
    for (const call of emissions.keys()) covered.add(call)
  }
  for (const file of sourceFiles)
    visit(file, (node) => {
      if (
        !ts.isCallExpression(node) ||
        framedWrites.has(node) ||
        !ts.isPropertyAccessExpression(node.expression) ||
        node.expression.name.text !== 'write'
      )
        return
      const binding = enclosingRouteBinding(node, checker, bindings)
      const key = binding && `${binding.method}:${binding.routeTemplate}`
      if (
        key &&
        sseBindings
          .get(key)
          ?.some((receiver) => sameWriteReceiver(receiver, writeReceiver(node, checker)))
      )
        unavailable(
          contracts,
          key,
          binding!,
          sourceLocation(file, node),
          new Error('SSE route writes an unmarked frame'),
          options,
        )
    })
  return covered
}

function unavailable(
  contracts: Map<string, BackendResponseContract>,
  key: string,
  binding: RouteBinding,
  location: string,
  error: unknown,
  options: DiscoverApiResponseContractsOptions | undefined,
): void {
  registerRouteContract(
    contracts,
    nextProtocolKey(contracts, key),
    binding,
    location,
    { bodyKind: 'content', statusKnowledge: 'unknown', mediaTypeKnowledge: 'unknown' },
    () => {
      throw error
    },
    options,
  )
}
