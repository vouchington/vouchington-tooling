import ts from '../contract-schema/typescript-api.mts'
import { discoverRegisteredRoutes } from './registered-route-catalog.mts'
import { handlerNodes, type HandlerProof } from './registered-route-handler-analysis.mts'
import { insideConfiguredImplementation } from './request-validation-match.mts'
import { sourceOf } from './request-validation-sites.mts'
import { createRouteWalker } from './request-validation-walker.mts'
import type {
  ExecutedCallbackConfig,
  FactoryConfig,
  RouteValidationFacts,
  ValidatorConfig,
} from './request-validation-types.mts'
import {
  HTTP_METHODS,
  propertyName,
  routeTemplateFromExpression,
  visit,
} from './response-contract-route-syntax.mts'

export type RequestValidationFactsInput = {
  program: ts.Program
  sourceFiles: readonly ts.SourceFile[]
  validators: readonly ValidatorConfig[]
  factories?: readonly FactoryConfig[]
  /** Configured calls that always run the listed inline callback properties. */
  executedCallbacks?: readonly ExecutedCallbackConfig[]
}

/** Maps each route's `source:method:template` identity to its registration call. */
function registrationCalls(sourceFiles: readonly ts.SourceFile[]) {
  const calls = new Map<string, ts.CallExpression>()
  for (const sourceFile of sourceFiles)
    visit(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return
      const method = propertyName(node.expression)?.toUpperCase()
      const template = routeTemplateFromExpression(node.expression)
      if (method && HTTP_METHODS.has(method) && template)
        calls.set(`${sourceOf(node)}|${method}:${template}`, node)
    })
  return calls
}

/**
 * Reports, per registered route, the configured validator and factory calls its handlers reach,
 * the operation key and carriers each covers, and the raw request carriers the handlers read.
 * Facts only: which routes must validate, and what counts as covered, stays with the caller.
 */
export function discoverRequestValidationFacts(
  input: RequestValidationFactsInput,
): Record<string, RouteValidationFacts> {
  const { program, sourceFiles, validators, factories = [], executedCallbacks = [] } = input
  const checker = program.getTypeChecker()
  const registrations = registrationCalls(sourceFiles)
  const result: Record<string, RouteValidationFacts> = {}
  for (const route of discoverRegisteredRoutes(program, sourceFiles)) {
    // Same call-selection logic as route discovery, so every discovered route has a registration.
    const registration = registrations.get(
      `${route.source}|${route.method}:${route.routeTemplate}`,
    )!
    const walker = createRouteWalker({
      checker,
      sourceFiles: new Set(sourceFiles),
      validators,
      factories,
      executedCallbacks,
    })
    for (const argument of registration.arguments.filter((item) => !ts.isStringLiteral(item))) {
      const proofs: HandlerProof[] = []
      const nodes = handlerNodes(argument, checker, new Map(), new Set(), false, proofs)
      walker.scanRegistration(argument)
      for (const declaration of nodes.filter(ts.isVariableDeclaration))
        walker.scanRegistration(declaration)
      for (const proof of proofs)
        if (
          !insideConfiguredImplementation(
            proof.node,
            [...validators, ...factories, ...executedCallbacks],
            checker,
          )
        )
          walker.walkHandler(proof)
    }
    result[`${route.method}:${route.routeTemplate}`] = {
      kind: route.kind,
      source: route.source,
      ...walker.facts,
    }
  }
  return result
}
