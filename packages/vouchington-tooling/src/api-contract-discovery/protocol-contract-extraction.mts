import ts from '../contract-schema/typescript-api.mts'
import { extractContractSchema, type ExtractedResponseContract } from '../contract-schema/index.mts'
import type { DiscoverApiResponseContractsOptions } from './response-contract-lenient.mts'
import { propertyType, stringLiterals, typeVariants } from './protocol-marker-analysis.mts'
import { noContentContract } from './response-contract-registration.mts'
import type { BackendResponseContract } from './response-contract-types.mts'

export function extractSseEvents(
  type: ts.Type,
  checker: ts.TypeChecker,
  source: string,
  options: DiscoverApiResponseContractsOptions | undefined,
): { eventName: string; contract: ExtractedResponseContract }[] {
  return typeVariants(type).flatMap((variant) => {
    const names = stringLiterals(propertyType(variant, 'event', checker))
    const contract = concretePayload(
      propertyType(variant, 'data', checker),
      checker,
      source,
      options,
    )
    return names.map((eventName) => ({ eventName, contract }))
  })
}

export function extractHttpVariants(
  type: ts.Type,
  checker: ts.TypeChecker,
  source: string,
  options: DiscoverApiResponseContractsOptions | undefined,
): Omit<BackendResponseContract, 'method' | 'routeTemplate'>[] {
  const carrier = propertyType(type, 'apiHttpResponseVariants', checker)
  const variants = typeVariants(carrier).filter(
    (variant) => !(variant.flags & ts.TypeFlags.Undefined),
  )
  if (variants.length === 0) throw new Error('HTTP response requires concrete variants')
  return variants.flatMap<Omit<BackendResponseContract, 'method' | 'routeTemplate'>>((variant) => {
    const status = propertyType(variant, 'status', checker)
    if (!(status.flags & ts.TypeFlags.NumberLiteral))
      throw new Error('HTTP response requires a literal status')
    const value = (status as ts.NumberLiteralType).value
    if (!Number.isInteger(value) || value < 100 || value > 599)
      throw new Error('HTTP response status is invalid')
    const kinds = stringLiterals(propertyType(variant, 'bodyKind', checker))
    if (kinds.length !== 1)
      throw new Error('HTTP response requires one concrete body kind per variant')
    const statusCodes: readonly [number] = [value]
    if (kinds[0] === 'none')
      return [
        {
          ...noContentContract(source),
          statusCodes,
          statusKnowledge: 'explicit' as const,
          bodyKind: 'none' as const,
          mediaTypeKnowledge: 'none' as const,
        },
      ]
    if (kinds[0] !== 'content') throw new Error('HTTP response body kind is invalid')
    const contract = concretePayload(
      propertyType(variant, 'body', checker),
      checker,
      source,
      options,
    )
    return stringLiterals(propertyType(variant, 'mediaType', checker)).map((mediaType) => ({
      ...contract,
      statusCodes,
      statusKnowledge: 'explicit' as const,
      bodyKind: 'content' as const,
      mediaType,
      mediaTypeKnowledge: 'known' as const,
      ...(value === 400 ? { includeDefaultError: true } : {}),
    }))
  })
}

function concretePayload(
  type: ts.Type,
  checker: ts.TypeChecker,
  source: string,
  options: DiscoverApiResponseContractsOptions | undefined,
): ExtractedResponseContract {
  const contract = extractContractSchema(type, checker, source, options)
  if (contract.schema.root.type === 'unknown')
    throw new Error('Protocol payload must have a concrete root')
  return contract
}
