import ts from '../contract-schema/typescript-api.mts'
import { registerPlatformCompilerLibraries } from './protocol-platform-callbacks.mts'

import { extractQueryParameterDescriptor } from './query-contract-extraction.mts'
import { contractError } from './response-contract-registration.mts'
import {
  collectHandlerBindings,
  enclosingRouteBinding,
  visit,
} from './response-contract-route-analysis.mts'
import type {
  BackendQueryContract,
  BackendQueryContractRegistry,
  QueryParameterContract,
} from './query-contract-types.mts'

export function discoverApiQueryContracts(
  program: ts.Program,
  sourceFiles: readonly ts.SourceFile[],
  knownResponseRoutes: ReadonlySet<string>,
): BackendQueryContractRegistry {
  registerPlatformCompilerLibraries(program)
  const checker = program.getTypeChecker()
  const handlerBindings = collectHandlerBindings(sourceFiles, checker)
  const contracts = new Map<string, BackendQueryContract>()
  const knownOperations = new Set([...knownResponseRoutes].map((key) => key.split('#')[0]!))

  for (const sourceFile of sourceFiles) {
    visit(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || !isApiQueryMarker(node.expression)) return
      const keyNode = node.arguments[0]
      if (!keyNode || !ts.isStringLiteral(keyNode)) {
        throw contractError(sourceFile, node, 'apiQuery requires a literal operation key')
      }
      const binding = enclosingRouteBinding(node, checker, handlerBindings)
      if (!binding)
        throw contractError(sourceFile, node, 'apiQuery must be inside an app.route handler')
      const expectedKey = `${binding.method}:${binding.routeTemplate}`
      if (keyNode.text !== expectedKey) {
        throw contractError(
          sourceFile,
          keyNode,
          `Query operation key "${keyNode.text}" does not match enclosing route ${expectedKey}`,
        )
      }
      if (!knownOperations.has(expectedKey)) {
        throw contractError(
          sourceFile,
          keyNode,
          `apiQuery references unknown response route ${expectedKey}`,
        )
      }
      if (contracts.has(expectedKey)) {
        throw contractError(sourceFile, keyNode, `Duplicate apiQuery marker for ${expectedKey}`)
      }
      if (node.arguments.length < 2) {
        throw contractError(
          sourceFile,
          node,
          'apiQuery requires at least one query contract carrier',
        )
      }

      const parameters: Record<string, QueryParameterContract> = Object.create(null) as Record<
        string,
        QueryParameterContract
      >
      for (const carrier of node.arguments.slice(1)) {
        const carrierType = checker.getTypeAtLocation(carrier)
        const queryContractSymbol = carrierType.getProperty('queryContract')
        if (!queryContractSymbol || queryContractSymbol.flags & ts.SymbolFlags.Optional) {
          throw contractError(
            sourceFile,
            carrier,
            'apiQuery carrier requires a queryContract property',
          )
        }
        const queryContractType = checker.getTypeOfSymbolAtLocation(queryContractSymbol, carrier)
        if (queryContractType.getStringIndexType()) {
          throw contractError(
            sourceFile,
            carrier,
            'apiQuery queryContract keys must be literal names',
          )
        }
        const properties = queryContractType.getProperties()
        if (properties.length === 0) {
          throw contractError(sourceFile, carrier, 'apiQuery queryContract must define parameters')
        }
        for (const property of properties) {
          const name = property.getName()
          if (property.flags & ts.SymbolFlags.Optional) {
            throw contractError(
              sourceFile,
              carrier,
              `Query parameter "${name}" must not be optional`,
            )
          }
          if (Object.hasOwn(parameters, name)) {
            throw contractError(sourceFile, carrier, `Duplicate query parameter contract: ${name}`)
          }
          const descriptorType = checker.getTypeOfSymbolAtLocation(property, carrier)
          parameters[name] = extractQueryParameterDescriptor(
            descriptorType,
            checker,
            sourceFile,
            carrier,
            name,
          )
        }
      }
      contracts.set(expectedKey, { ...binding, parameters })
    })
  }

  return Object.fromEntries(
    [...contracts.entries()].toSorted(([left], [right]) => left.localeCompare(right)),
  )
}

function isApiQueryMarker(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && expression.text === 'apiQuery'
}
