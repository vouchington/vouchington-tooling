import { queryParameters } from './build-openapi-query.mts'
import { buildOperationRequestBody } from './build-openapi-request.mts'
import { buildOperationResponse } from './build-openapi-response.mts'
import { createComponentRegistry } from './component-registry.mts'
import {
  responseStatusCodesForContract,
  routeShape,
  type QueryOperationContract,
  type RegisteredRoute,
  type RequestContract,
  type ResponseContract,
} from './operation-types.mts'
import { registerOpenApiErrorResponse } from './openapi-error-response.mts'
import {
  canonicalTemplatesByShape,
  catalogResponse,
  operationId,
  pathParameters,
} from './openapi-route-helpers.mts'
import type { OpenApiDocument, OpenApiOperation } from './openapi-types.mts'

export type BuildOpenApiDocumentInput = {
  title: string
  version?: string
  responseContracts: Record<string, ResponseContract>
  requestContracts?: Record<string, RequestContract>
  queryContracts?: Readonly<Record<string, QueryOperationContract>>
  registeredRoutes?: readonly RegisteredRoute[]
}

export function buildOpenApiDocument(input: BuildOpenApiDocumentInput): OpenApiDocument {
  const registry = createComponentRegistry()
  registerOpenApiErrorResponse(registry)
  const requestContracts = input.requestContracts ?? {}
  const queryContracts = input.queryContracts ?? {}
  const registeredRoutes = input.registeredRoutes ?? []
  const contractGroups = groupContractsByRoute(input.responseContracts)
  const contractGroupsByShape = uniqueShapeGroups(contractGroups)
  const catalogByShape = new Map(
    registeredRoutes.map((route) => [`${route.method}:${routeShape(route.routeTemplate)}`, route]),
  )
  const operationKeys = new Set([...contractGroupsByShape.keys(), ...catalogByShape.keys()])
  const canonicalTemplates = canonicalTemplatesByShape([
    ...[...contractGroups.values()].map((variants) => variants[0]!.routeTemplate),
    ...registeredRoutes.map((route) => route.routeTemplate),
  ])

  const paths: Record<string, Record<string, OpenApiOperation>> = {}
  const unavailableRoutes: string[] = []
  const unavailableRequestRoutes: string[] = []

  for (const shapeKey of [...operationKeys].toSorted()) {
    const separator = shapeKey.indexOf(':')
    const method = shapeKey.slice(0, separator)
    const catalogRoute = catalogByShape.get(shapeKey)
    const variants = contractGroupsByShape.get(shapeKey)
    const routeTemplate = catalogRoute?.routeTemplate ?? variants![0]!.routeTemplate
    const groupKey = `${method}:${routeTemplate}`
    assertFixedNoContent(catalogRoute, variants, groupKey)
    const rendered = renderOperation(catalogRoute, variants, registry)
    if (rendered.unavailable) unavailableRoutes.push(groupKey)
    const { requestBody, unavailable: requestUnavailable } = buildOperationRequestBody(
      requestContracts[groupKey],
      registry,
    )
    if (requestUnavailable) unavailableRequestRoutes.push(groupKey)
    const canonicalTemplate = canonicalTemplates.get(routeShape(routeTemplate))!
    const parameters = [
      ...pathParameters(canonicalTemplate),
      ...queryParameters(queryContracts[groupKey]?.parameters),
    ]
    const operation: OpenApiOperation = {
      operationId: operationId(method, routeTemplate),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: { ...rendered.responses, default: { $ref: '#/components/responses/Error' } },
      ...(rendered.unavailable
        ? {
            'x-schema-unavailable': true as const,
            /* v8 ignore next -- catalog and conversion failures always include a reason */
            ...(rendered.unavailableReason
              ? { 'x-schema-unavailable-reason': rendered.unavailableReason }
              : {}),
          }
        : {}),
    }
    const path = canonicalTemplate.replace(/:(\w+)/g, '{$1}')
    paths[path] ??= {}
    paths[path]![method.toLowerCase()] = operation
  }

  return {
    openapi: '3.1.0',
    info: { title: input.title, version: input.version ?? '1.0.0' },
    paths,
    components: {
      schemas: registry.schemas(),
      responses: {
        Error: {
          description: 'Error',
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${registry.refName('ErrorBody')}` },
            },
          },
        },
      },
    },
    'x-unavailable-routes': unavailableRoutes.toSorted(),
    'x-unavailable-request-routes': unavailableRequestRoutes.toSorted(),
  }
}

function groupContractsByRoute(
  contracts: Record<string, ResponseContract>,
): Map<string, ResponseContract[]> {
  const groups = new Map<string, ResponseContract[]>()
  for (const contract of Object.values(contracts)) {
    const groupKey = `${contract.method}:${contract.routeTemplate}`
    const variants = groups.get(groupKey) ?? []
    variants.push(contract)
    groups.set(groupKey, variants)
  }
  return groups
}

function uniqueShapeGroups(
  groups: Map<string, ResponseContract[]>,
): Map<string, ResponseContract[]> {
  const contractGroupsByShape = new Map<string, ResponseContract[]>()
  for (const [, variants] of groups) {
    const { method, routeTemplate } = variants[0]!
    const shapeKey = `${method}:${routeShape(routeTemplate)}`
    const existing = contractGroupsByShape.get(shapeKey)
    if (existing)
      throw new Error(
        `response contracts contain duplicate normalized route ${shapeKey}: ${existing[0]!.routeTemplate} and ${routeTemplate}`,
      )
    contractGroupsByShape.set(shapeKey, variants)
  }
  return contractGroupsByShape
}

function assertFixedNoContent(
  catalogRoute: RegisteredRoute | undefined,
  variants: ResponseContract[] | undefined,
  groupKey: string,
): void {
  if (catalogRoute?.kind !== 'fixed-no-content' || !variants) return
  if (
    variants.every(
      (variant) =>
        variant.bodyKind === 'none' &&
        responseStatusCodesForContract(variant).every(
          (status) => status === catalogRoute.fixedStatus,
        ),
    )
  )
    return
  throw new Error(
    `OpenAPI fixed-no-content metadata conflicts with extracted response variants for ${groupKey}`,
  )
}

function renderOperation(
  catalogRoute: RegisteredRoute | undefined,
  variants: ResponseContract[] | undefined,
  registry: ReturnType<typeof createComponentRegistry>,
) {
  if (catalogRoute?.kind === 'sse' || catalogRoute?.kind === 'fixed-no-content')
    return catalogResponse(catalogRoute.kind, catalogRoute.fixedStatus)
  if (variants) return buildOperationResponse(variants, registry)
  if (catalogRoute?.kind === 'error-only') return catalogResponse('error-only')
  return catalogResponse('ordinary')
}
