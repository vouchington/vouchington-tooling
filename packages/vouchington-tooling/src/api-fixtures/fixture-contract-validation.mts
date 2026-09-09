import type { ContractSchema } from '../openapi-document/contract-schema-types.mts'
import { validateResponseContract } from '../contract-schema/contract-schema-validator.mts'

export type FixtureValidationCase = {
  id: string
  method: string
  route: { routeTemplate: string }
  status: number
  body: unknown
  backendResponseContractKey: string
}

export type FixtureValidationContract = {
  method: string
  routeTemplate: string
  schema: ContractSchema
  statusCodes?: readonly number[]
}

export type ValidateFixtureContractsOptions = {
  routeShape: (routeTemplate: string) => string
  statusCodesForContract: (contract: FixtureValidationContract) => number[]
}

export function validateFixtureContracts(
  fixtureCases: readonly FixtureValidationCase[],
  contracts: Record<string, FixtureValidationContract>,
  options: ValidateFixtureContractsOptions,
): void {
  const usedKeys = new Set<string>()
  const errors: string[] = []
  for (const fixtureCase of fixtureCases) {
    const key = fixtureCase.backendResponseContractKey
    const contract = contracts[key]
    if (!contract) {
      errors.push(`${fixtureCase.id}: response contract "${key}" was not found`)
      continue
    }
    usedKeys.add(key)
    const fixtureOperation = `${fixtureCase.method}:${fixtureCase.route.routeTemplate}`
    const contractOperation = `${contract.method}:${contract.routeTemplate}`
    if (
      fixtureCase.method !== contract.method ||
      options.routeShape(fixtureCase.route.routeTemplate) !==
        options.routeShape(contract.routeTemplate)
    ) {
      errors.push(
        `${fixtureCase.id}: fixture operation ${fixtureOperation} does not match response contract "${key}" (${contractOperation})`,
      )
      continue
    }
    const statuses = options.statusCodesForContract(contract)
    if (!statuses.includes(fixtureCase.status)) {
      errors.push(
        `${fixtureCase.id}: status ${fixtureCase.status} is not declared by response contract "${key}" (${contractOperation}); available statuses: ${statuses.join(', ') || 'none (status unknown)'}`,
      )
    }
    for (const issue of validateResponseContract(contract.schema, fixtureCase.body)) {
      errors.push(`${fixtureCase.id} ${issue.path}: ${issue.message}`)
    }
  }
  for (const key of Object.keys(contracts)) {
    if (!usedKeys.has(key)) errors.push(`Response contract "${key}" is not used by a fixture`)
  }
  if (errors.length > 0) {
    throw new Error(['Fixture contract validation failed:', ...errors].join('\n'))
  }
}
