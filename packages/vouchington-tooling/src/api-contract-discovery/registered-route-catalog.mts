import ts from '../contract-schema/typescript-api.mts'

import { handlerNodes, type HandlerProof } from './registered-route-handler-analysis.mts'
import { isTerminal405Handler } from './registered-route-terminal-error.mts'
import {
  propertyName,
  routeTemplateFromExpression,
  visit,
} from './response-contract-route-analysis.mts'

export type RegisteredRoute = {
  method: string
  routeTemplate: string
  kind: 'ordinary' | 'sse' | 'error-only' | 'fixed-no-content'
  fixedStatus?: number
  source: string
}

export const routeShape = (routeTemplate: string): string => routeTemplate.replace(/:[^/]+/g, ':')
export function discoverRegisteredRoutes(
  program: ts.Program,
  sourceFiles: readonly ts.SourceFile[],
): RegisteredRoute[] {
  const checker = program.getTypeChecker()
  const routes: RegisteredRoute[] = []
  const registrations = new Map<string, RegisteredRoute>()
  sourceFiles.forEach((sourceFile) => {
    visit(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return
      const method = propertyName(node.expression)?.toUpperCase()
      if (!method || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return
      const routeTemplate = routeTemplateFromExpression(node.expression)
      if (!routeTemplate) return
      const key = `${method}:${routeShape(routeTemplate)}`
      const source = `${sourceFile.fileName}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
      const classification = classifyHandler(node, checker, method, routeTemplate)
      const route = {
        method,
        routeTemplate,
        ...classification,
        source,
      } satisfies RegisteredRoute
      const existing = registrations.get(key)
      if (existing)
        throw new Error(`Duplicate registered API route ${key} at ${existing.source} and ${source}`)
      registrations.set(key, route)
      routes.push(route)
    })
  })
  return routes.toSorted((left, right) =>
    `${left.method}:${left.routeTemplate}`.localeCompare(`${right.method}:${right.routeTemplate}`),
  )
}

function classifyHandler(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  method: string,
  routeTemplate: string,
): Pick<RegisteredRoute, 'kind' | 'fixedStatus'> {
  const nodes = call.arguments.flatMap((argument) => handlerNodes(argument, checker))
  if (nodes.length === 0)
    throw new Error(`Cannot inspect registered route handler ${method}:${routeTemplate}`)
  let sse = false
  const proofGroups = call.arguments
    .filter((argument) => !ts.isStringLiteral(argument))
    .map((argument) => {
      const proofs: HandlerProof[] = []
      const nodes = handlerNodes(argument, checker, new Map(), new Set(), true, proofs)
      return nodes.some(ts.isFunctionLike) ? proofs : []
    })
  const error405 =
    proofGroups.length > 0 &&
    proofGroups.every(
      (handlers) =>
        handlers.length > 0 &&
        handlers.every((proof) => isTerminal405Handler(proof.node, checker, proof.bindings)),
    )
  let fixedStatus: number | undefined
  nodes.forEach((node) => {
    visit(node, (child) => {
      if (!ts.isCallExpression(child)) return
      if (ts.isIdentifier(child.expression) && child.expression.text === 'apiOpenApiNoContent') {
        const [key, status] = child.arguments
        if (!key || !ts.isStringLiteral(key) || key.text !== `${method}:${routeTemplate}`)
          throw new Error(
            `apiOpenApiNoContent key must match registered route ${method}:${routeTemplate}`,
          )
        if (!status || !ts.isNumericLiteral(status))
          throw new Error('apiOpenApiNoContent status requires a numeric literal')
        const value = Number(status.text)
        if (fixedStatus !== undefined && fixedStatus !== value)
          throw new Error(`Conflicting apiOpenApiNoContent statuses for ${method}:${routeTemplate}`)
        fixedStatus = value
      }
      if (ts.isIdentifier(child.expression) && child.expression.text === 'startSSE') sse = true
      if (
        ts.isPropertyAccessExpression(child.expression) &&
        child.expression.name.text === 'setType' &&
        child.arguments[0] &&
        ts.isStringLiteral(child.arguments[0]) &&
        child.arguments[0].text.toLowerCase() === 'text/event-stream'
      )
        sse = true
    })
  })
  if (fixedStatus !== undefined) {
    if (sse)
      throw new Error(
        `apiOpenApiNoContent conflicts with SSE response handling for ${method}:${routeTemplate}`,
      )
    return { kind: 'fixed-no-content', fixedStatus }
  }
  return { kind: sse ? 'sse' : error405 ? 'error-only' : 'ordinary' }
}
