import type { SharedDbScopeEvent } from '@vouchington/postgres/query-telemetry'
import { describe, expect, it } from 'vitest'
import {
  getSharedOwnedKeysetReadPolicy,
  isImmediateUuidPredecessor,
  OwnedKeysetReadPolicy,
  type OwnedKeysetFixture,
  type SharedDbOwnedKeysetRead,
} from './index.mts'

const TARGET: { operation: string; table: string } = {
  operation: 'searchInbox',
  table: 'inbox_items',
}

const FIXTURE: OwnedKeysetFixture = {
  actorId: 'actor-1',
  id: '019c64e6-f710-7000-8000-000000000002',
  afterId: '019c64e6-f710-7000-8000-000000000001',
  timestamp: '2026-01-01T00:00:00.000000Z',
}

type TestEvent = SharedDbScopeEvent<string, string, SharedDbOwnedKeysetRead>

function startEvent(
  identity: symbol,
  overrides: Partial<Extract<SharedDbOwnedKeysetRead, { phase: 'start' }>> = {},
): TestEvent {
  return {
    operation: TARGET.operation,
    table: TARGET.table,
    scope: { kind: 'global' },
    keysetRead: {
      phase: 'start',
      identity,
      actorId: FIXTURE.actorId,
      after: { timestamp: FIXTURE.timestamp, id: FIXTURE.afterId },
      limit: 1,
      sqlLimit: 2,
      ...overrides,
    },
  }
}

function completedEvent(
  identity: symbol,
  overrides: Partial<Extract<SharedDbOwnedKeysetRead, { phase: 'completed' }>> = {},
): TestEvent {
  return {
    operation: TARGET.operation,
    table: TARGET.table,
    scope: { kind: 'global' },
    keysetRead: {
      phase: 'completed',
      identity,
      rowCount: 1,
      first: { id: FIXTURE.id, timestamp: FIXTURE.timestamp },
      ...overrides,
    },
  }
}

describe('isImmediateUuidPredecessor', () => {
  it('accepts exact +1 UUID pairs and rejects non-predecessors or invalid UUIDs', () => {
    expect(isImmediateUuidPredecessor(FIXTURE.afterId, FIXTURE.id)).toBe(true)
    expect(
      isImmediateUuidPredecessor(
        '019c64e6-f710-7000-8000-000000000000',
        '019c64e6-f710-7000-8000-000000000002',
      ),
    ).toBe(false)
    expect(isImmediateUuidPredecessor('not-a-uuid', FIXTURE.id)).toBe(false)
    expect(isImmediateUuidPredecessor(FIXTURE.afterId, 'not-a-uuid')).toBe(false)
  })
})

describe('OwnedKeysetReadPolicy', () => {
  it('validates registration preconditions and admits matching start + completion', () => {
    const policy = new OwnedKeysetReadPolicy(TARGET)
    expect(() => policy.register('', FIXTURE, () => {})).toThrow('immediate UUID predecessor')
    expect(() => policy.register('test:1', { ...FIXTURE, afterId: FIXTURE.id }, () => {})).toThrow(
      'immediate UUID predecessor',
    )

    const failures: string[] = []
    const close = policy.register('test:1', FIXTURE, (_event, message) => {
      failures.push(message)
    })
    const identity = Symbol('read-1')
    expect(policy.observe(startEvent(identity), 'test:1')).toBe(true)
    expect(policy.observe(completedEvent(identity, { rowCount: 2 }), 'test:1')).toBe(true)
    expect(() => close()).not.toThrow()
    // Second close is a no-op.
    expect(() => close()).not.toThrow()
    expect(failures).toEqual([])
  })

  it('ignores non-matching operations, tables, scopes, limits, or actors', () => {
    const policy = new OwnedKeysetReadPolicy({ ...TARGET, limit: 2, sqlLimit: 3 })
    const close = policy.register('test:1', FIXTURE, () => {})
    const id = Symbol('read')
    try {
      expect(policy.observe({ ...startEvent(id), operation: 'other' }, 'test:1')).toBe(false)
      expect(policy.observe({ ...startEvent(id), table: 'other' }, 'test:1')).toBe(false)
      expect(
        policy.observe({ ...startEvent(id), scope: { kind: 'ids', ids: ['x'] } }, 'test:1'),
      ).toBe(false)
      expect(
        policy.observe(
          { operation: TARGET.operation, table: TARGET.table, scope: { kind: 'global' } },
          'test:1',
        ),
      ).toBe(false)
      expect(policy.observe(startEvent(id, { limit: 1, sqlLimit: 3 }), 'test:1')).toBe(false)
      expect(policy.observe(startEvent(id, { limit: 2, sqlLimit: 4 }), 'test:1')).toBe(false)
      expect(
        policy.observe(startEvent(id, { actorId: 'other-actor', limit: 2, sqlLimit: 3 }), 'test:1'),
      ).toBe(false)
      expect(
        policy.observe(startEvent(id, { after: undefined, limit: 2, sqlLimit: 3 }), 'test:1'),
      ).toBe(false)
      expect(policy.observe(startEvent(id, { limit: 2, sqlLimit: 3 }), 'other-test')).toBe(false)
    } finally {
      close()
    }
  })

  it('rejects reused identity, unmatched or duplicate completion, wrong row bounds, and unfinished reads', () => {
    const policy = new OwnedKeysetReadPolicy(TARGET)
    const reported: string[] = []
    const close = policy.register('test:1', FIXTURE, (_event, message) => {
      reported.push(message)
    })

    const id1 = Symbol('read-1')
    expect(policy.observe(startEvent(id1), 'test:1')).toBe(true)
    expect(() => policy.observe(startEvent(id1), 'test:1')).toThrow(
      'Owned keyset query identity was reused',
    )

    expect(() => policy.observe(completedEvent(Symbol('unknown')), 'test:1')).toThrow(
      'Owned keyset completion has no matching admission',
    )
    expect(() => policy.observe(completedEvent(id1), 'other-owner')).toThrow(
      'Owned keyset completion has no matching admission',
    )

    expect(() => policy.observe(completedEvent(id1, { rowCount: 0 }), 'test:1')).toThrow(
      'Committed keyset result did not prove its owned first row and bound',
    )
    expect(() => policy.observe(completedEvent(id1, { rowCount: 3 }), 'test:1')).toThrow(
      'Committed keyset result did not prove its owned first row and bound',
    )
    expect(() => policy.observe(completedEvent(id1, { rowCount: 1.5 }), 'test:1')).toThrow(
      'Committed keyset result did not prove its owned first row and bound',
    )
    expect(() => policy.observe(completedEvent(id1, { first: undefined }), 'test:1')).toThrow(
      'Committed keyset result did not prove its owned first row and bound',
    )
    expect(() =>
      policy.observe(
        completedEvent(id1, { first: { id: FIXTURE.id, timestamp: 'wrong' } }),
        'test:1',
      ),
    ).toThrow('Committed keyset result did not prove its owned first row and bound')

    expect(policy.observe(completedEvent(id1), 'test:1')).toBe(true)
    expect(() => policy.observe(completedEvent(id1), 'test:1')).toThrow(
      'Owned keyset query completed twice',
    )

    // Start a second read and close without completing it.
    const id2 = Symbol('read-2')
    expect(policy.observe(startEvent(id2), 'test:1')).toBe(true)
    expect(() => close()).toThrow('Owned keyset read did not complete')
    expect(reported).toEqual([
      'Owned keyset read did not complete with its committed owned first row',
    ])
  })
})

describe('getSharedOwnedKeysetReadPolicy', () => {
  it('returns the same policy instance for the same database/key and rejects blank keys', () => {
    const db = `keyset_db_${crypto.randomUUID().replaceAll('-', '_')}`
    const first = getSharedOwnedKeysetReadPolicy({ database: db, ...TARGET })
    const second = getSharedOwnedKeysetReadPolicy({ database: db, ...TARGET })
    expect(second).toBe(first)

    const custom = getSharedOwnedKeysetReadPolicy({
      database: db,
      policyKey: `${db}.custom-policy`,
      ...TARGET,
    })
    expect(custom).not.toBe(first)

    expect(() =>
      getSharedOwnedKeysetReadPolicy({ database: db, policyKey: '   ', ...TARGET }),
    ).toThrow(RangeError)
  })
})
