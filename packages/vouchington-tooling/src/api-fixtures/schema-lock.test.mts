import { describe, expect, it } from 'vitest'

import { buildFixtureSchemaLock, responseSchemaFor } from './schema-lock.mts'

const source = {
  kind: 'generated' as const,
  generator: 'tests/schema-lock',
  caseRoot: 'tests',
}

describe('fixture schema lock', () => {
  it('pins injected discriminator keys as string consts', () => {
    const withKind = responseSchemaFor(
      'widgets.show',
      undefined,
      { kind: 'gadget', name: 'alpha' },
      new Set(['kind']),
    )
    const withoutKind = responseSchemaFor(
      'widgets.show',
      undefined,
      { kind: 'gadget', name: 'alpha' },
      new Set(),
    )

    expect(withKind.hash).not.toBe(withoutKind.hash)
    expect(
      responseSchemaFor(
        'widgets.show',
        undefined,
        { kind: 'widget', name: 'alpha' },
        new Set(['kind']),
      ).hash,
    ).not.toBe(withKind.hash)
  })

  it('groups fixtures by schema key and backend contract hash', () => {
    const lock = buildFixtureSchemaLock({
      cases: [
        {
          id: 'widgets.a',
          responseSchemaKey: 'widget',
          body: { name: 'a' },
          backendResponseContractKey: 'GET:/widgets',
        },
        {
          id: 'widgets.b',
          responseSchemaKey: 'widget',
          body: { name: 'b' },
          backendResponseContractKey: 'GET:/widgets',
        },
      ],
      backendContracts: { 'GET:/widgets': { hash: 'abc' } },
      discriminatorKeys: new Set(),
      source,
    })

    expect(lock).toEqual({
      version: 2,
      source,
      schemas: {
        widget: {
          hash: responseSchemaFor('widgets.a', 'widget', { name: 'a' }, new Set()).hash,
          fixtureIds: ['widgets.a', 'widgets.b'],
        },
      },
      backendResponseContracts: {
        'GET:/widgets': { hash: 'abc', fixtureIds: ['widgets.a', 'widgets.b'] },
      },
    })
  })

  it('rejects colliding shapes for the same schema key', () => {
    expect(() =>
      buildFixtureSchemaLock({
        cases: [
          {
            id: 'widgets.a',
            responseSchemaKey: 'widget',
            body: { name: 'a' },
            backendResponseContractKey: 'GET:/widgets',
          },
          {
            id: 'widgets.b',
            responseSchemaKey: 'widget',
            body: { count: 1 },
            backendResponseContractKey: 'GET:/widgets',
          },
        ],
        backendContracts: { 'GET:/widgets': { hash: 'abc' } },
        discriminatorKeys: new Set(),
        source,
      }),
    ).toThrow('maps to multiple shapes')
  })

  it('covers toJSON values, id-keyed maps, integers, and sparse arrays', () => {
    const stamped = {
      toJSON() {
        return { id: 'a1', count: 1 }
      },
    }
    const idMap = {
      '11111111-1111-4111-8111-111111111111': { name: 'alpha' },
      'widget-2': { name: 'beta' },
    }
    const withSparse = responseSchemaFor('sparse', undefined, [1, undefined, 2.5], new Set())
    const withJson = responseSchemaFor('json', undefined, stamped, new Set())
    const withMap = responseSchemaFor('map', undefined, idMap, new Set())

    expect(withSparse.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(withJson.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(withMap.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(
      buildFixtureSchemaLock({
        cases: [
          {
            id: 'widgets.map',
            body: idMap,
            backendResponseContractKey: 'GET:/widgets',
          },
        ],
        backendContracts: { 'GET:/widgets': { hash: 'abc' }, 'GET:/unused': { hash: 'def' } },
        discriminatorKeys: new Set(),
        source,
      }).backendResponseContracts['GET:/unused'],
    ).toEqual({ hash: 'def', fixtureIds: [] })
  })
})
