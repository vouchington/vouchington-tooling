import ts from '../contract-schema/typescript-api.mts'
import { nextProtocolKey } from './protocol-contract-keys.mts'
import { extractContractSchema } from '../contract-schema/index.mts'
import { extractHttpVariants, extractSseEvents } from './protocol-contract-extraction.mts'
import { extractHttpBodyKinds } from './protocol-http-body-kinds.mts'
import { registerHttpProtocols, type PendingHttp } from './protocol-http-registration.mts'
import { protocolBindingRequested, requestedProtocolKey } from './protocol-requested-keys.mts'
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
import { rejectRawSseWrites, type SseRouteWrites } from './protocol-sse-raw-writes.mts'
import { sseEmission } from './protocol-sse-emission.mts'
import type { createHttpContextValueResolver } from './protocol-http-context-values.mts'

export function discoverProtocolContracts(
  sourceFiles: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
  contracts: Map<string, BackendResponseContract>,
  options: DiscoverApiResponseContractsOptions | undefined,
  requestedKeys?: ReadonlySet<string>,
  httpValues?: ReturnType<typeof createHttpContextValueResolver>,
): Set<ts.CallExpression> {
  if (requestedKeys?.size === 0) return new Set()
  const calls: ts.CallExpression[] = []
  for (const file of sourceFiles)
    visit(file, (node) => {
      if (ts.isCallExpression(node)) calls.push(node)
    })
  const pending: PendingHttp[] = []
  const allocated = new Map<string, undefined>()
  const framedWrites = new Set<ts.CallExpression>()
  const sseBindings = new Map<string, SseRouteWrites>()
  for (const file of sourceFiles)
    visit(file, (node) => {
      if (!ts.isCallExpression(node)) return
      const marker = protocolMarker(node.expression, checker)
      if (!marker) return
      const binding = enclosingRouteBinding(node, checker, bindings, false)
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
      let errorKeys: string[] = []
      try {
        if (marker === 'apiSseFrame') {
          const rowKey = reserveKey(allocated, keyNode.text)
          errorKeys = [rowKey]
          if (!requestedProtocolKey(rowKey, binding, requestedKeys)) {
            if (ts.isCallExpression(node.parent)) framedWrites.add(node.parent)
            return
          }
          const body = node.arguments[1]
          if (!body) throw new Error(`${marker} requires a protocol body`)
          const { write, receiver, status } = sseEmission(node, checker, calls, binding, bindings)
          const sseEvents = extractSseEvents(
            checker.getTypeAtLocation(body),
            checker,
            location,
            options,
          )
          contracts.set(rowKey, {
            ...extractContractSchema(checker.getStringType(), checker, location, options),
            ...binding,
            bodyKind: 'content',
            mediaType: 'text/event-stream',
            mediaTypeKnowledge: 'known',
            ...status,
            sseEvents,
          })
          framedWrites.add(write)
          const routeWrites = sseBindings.get(prefix) ?? { receivers: [], keys: [] }
          routeWrites.receivers.push(receiver)
          routeWrites.keys.push(rowKey)
          sseBindings.set(prefix, routeWrites)
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
          const keys: string[] = []
          errorKeys = keys
          const variants = extractHttpVariants(
            checker.getTypeAtLocation(node),
            checker,
            location,
            options,
            () => {
              const rowKey = reserveKey(allocated, keyNode.text)
              if (!requestedProtocolKey(rowKey, binding, requestedKeys)) return false
              keys.push(rowKey)
              return true
            },
          )
          pending.push({
            call: node,
            symbol,
            binding,
            variants,
            get declaredBodyKinds() {
              return extractHttpBodyKinds(checker.getTypeAtLocation(node), checker)
            },
            keys,
          })
        }
      } catch (error) {
        for (const key of errorKeys.length ? errorKeys : [reserveKey(allocated, keyNode.text)])
          unavailable(contracts, key, binding, location, error, options)
      }
    })
  const covered = registerHttpProtocols(
    pending,
    contracts,
    checker,
    (response, error) => {
      for (const key of response.keys)
        unavailable(contracts, key, response.binding, response.variants[0]!.source, error, options)
    },
    httpValues,
  )
  rejectRawSseWrites(
    sourceFiles,
    checker,
    bindings,
    framedWrites,
    sseBindings,
    (node, binding, keys) => {
      for (const key of keys) {
        contracts.delete(key)
        unavailable(
          contracts,
          key,
          binding,
          sourceLocation(node.getSourceFile(), node),
          new Error('SSE route writes an unmarked frame'),
          options,
        )
      }
    },
  )
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

function reserveKey(allocated: Map<string, undefined>, key: string): string {
  const row = nextProtocolKey(allocated, key)
  allocated.set(row, undefined)
  return row
}
