import { describe, expect, it } from 'vitest'

import {
  validateFixtureContracts,
  type FixtureValidationCase,
  type FixtureValidationContract,
} from './fixture-contract-validation.mts'

const options = {
  routeShape: (template: string) => template.replace(/:[^/]+/g, ':'),
  statusCodesForContract: (contract: FixtureValidationContract) => [
    ...(contract.statusCodes ?? []),
  ],
}

describe('fixture contract validation', () => {
  it('validates fixture statuses against exact response variants', () => {
    const contracts = {
      'POST:/widgets/imports#success': contract('POST', '/widgets/imports', [201]),
      'POST:/widgets/imports#validation': contract('POST', '/widgets/imports', [422]),
    }
    const success = fixture(
      'widgets.success',
      'POST:/widgets/imports#success',
      '/widgets/imports',
      201,
    )
    const validation = fixture(
      'widgets.validation',
      'POST:/widgets/imports#validation',
      '/widgets/imports',
      422,
    )

    expect(() => validateFixtureContracts([success, validation], contracts, options)).not.toThrow()
    expect(() =>
      validateFixtureContracts(
        [
          { ...success, status: 422 },
          { ...validation, status: 201 },
        ],
        contracts,
        options,
      ),
    ).toThrowError(
      [
        'Fixture contract validation failed:',
        'widgets.success: status 422 is not declared by response contract "POST:/widgets/imports#success" (POST:/widgets/imports); available statuses: 201',
        'widgets.validation: status 201 is not declared by response contract "POST:/widgets/imports#validation" (POST:/widgets/imports); available statuses: 422',
      ].join('\n'),
    )
  })

  it('aggregates create and delete status mismatches deterministically', () => {
    const create = fixture('widgets.create', 'POST:/widgets', '/widgets', 200)
    const remove = {
      ...fixture('widgets.delete', 'DELETE:/widgets/:widgetId', '/widgets/:id', 200, 'DELETE'),
      body: null,
    }
    const deleteContract: FixtureValidationContract = {
      ...contract('DELETE', '/widgets/:widgetId', [204]),
      schema: { root: { type: 'null' }, definitions: {} },
    }

    expect(() =>
      validateFixtureContracts(
        [create, remove],
        {
          'POST:/widgets': contract('POST', '/widgets', [201]),
          'DELETE:/widgets/:widgetId': deleteContract,
        },
        options,
      ),
    ).toThrowError(
      [
        'Fixture contract validation failed:',
        'widgets.create: status 200 is not declared by response contract "POST:/widgets" (POST:/widgets); available statuses: 201',
        'widgets.delete: status 200 is not declared by response contract "DELETE:/widgets/:widgetId" (DELETE:/widgets/:widgetId); available statuses: 204',
      ].join('\n'),
    )
  })

  it('reports missing contracts and body schema mismatches', () => {
    const contracts = {
      'POST:/widgets': contract('POST', '/widgets', [200]),
    }
    expect(() =>
      validateFixtureContracts(
        [fixture('widgets.missing', 'POST:/widgets/missing', '/widgets', 200)],
        contracts,
        options,
      ),
    ).toThrow('response contract "POST:/widgets/missing" was not found')

    expect(() =>
      validateFixtureContracts(
        [{ ...fixture('widgets.body', 'POST:/widgets', '/widgets', 200), body: null }],
        contracts,
        options,
      ),
    ).toThrow('widgets.body $: Expected object, received null')

    const { statusCodes: _ignored, ...withoutStatuses } = contract('POST', '/widgets', [201])
    expect(() =>
      validateFixtureContracts(
        [fixture('widgets.status', 'POST:/widgets', '/widgets', 200)],
        { 'POST:/widgets': withoutStatuses },
        {
          ...options,
          statusCodesForContract: () => [],
        },
      ),
    ).toThrow('available statuses: none (status unknown)')
  })

  it('accepts route parameter aliases and rejects a binding to another operation', () => {
    const aliasedContract = contract('GET', '/widgets/:widgetId', [200])
    const contracts = {
      'GET:/widgets/:widgetId': {
        ...contract('GET', '/widgets/:widgetId', [201]),
        schema: { root: { type: 'string' } as const, definitions: {} },
      },
      'POST:/widgets': contract('POST', '/widgets', [200]),
    }
    const aliasedParam = fixture(
      'widgets.show',
      'GET:/widgets/:widgetId',
      '/widgets/:id',
      200,
      'GET',
    )
    expect(() =>
      validateFixtureContracts(
        [aliasedParam],
        { 'GET:/widgets/:widgetId': aliasedContract },
        options,
      ),
    ).not.toThrow()

    const wrongBinding = fixture('widgets.create', 'GET:/widgets/:widgetId', '/widgets', 200)
    expect(() => validateFixtureContracts([wrongBinding], contracts, options)).toThrowError(
      [
        'Fixture contract validation failed:',
        'widgets.create: fixture operation POST:/widgets does not match response contract "GET:/widgets/:widgetId" (GET:/widgets/:widgetId)',
        'Response contract "POST:/widgets" is not used by a fixture',
      ].join('\n'),
    )
  })
})

function contract(
  method: string,
  routeTemplate: string,
  statusCodes: readonly [number, ...number[]],
): FixtureValidationContract {
  return {
    method,
    routeTemplate,
    statusCodes,
    schema: {
      root: { type: 'object', properties: {}, additionalProperties: false },
      definitions: {},
    },
  }
}

function fixture(
  id: string,
  backendResponseContractKey: string,
  routeTemplate: string,
  status: number,
  method = 'POST',
): FixtureValidationCase {
  return {
    id,
    method,
    route: { routeTemplate },
    status,
    body: {},
    backendResponseContractKey,
  }
}
