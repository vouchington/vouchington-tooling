import { describe, expect, it } from 'vitest'

import { buildSchemaSnapshot } from './build-snapshot.mts'
import {
  catalog,
  emptyGrowth,
  WIDGETS_RANGE_POLICY,
  widgetsGrowth,
} from './snapshot.test-helpers.mts'

describe('buildSchemaSnapshot — partitioning and growth classification', () => {
  it('attaches the growth partition policy and marks growth unbounded for a partitioned table', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [
          {
            table_name: 'widgets',
            relkind: 'p',
            partition_strategy: 'r',
            partition_key: 'RANGE (created_at)',
            comment: null,
          },
        ],
      }),
      widgetsGrowth(),
    )

    expect(snapshot.tables.widgets?.partition).toEqual(WIDGETS_RANGE_POLICY)
    expect(snapshot.tables.widgets?.physicalPartition).toEqual({
      strategy: 'range',
      key: 'RANGE (created_at)',
    })
    expect(snapshot.tables.widgets?.growth).toBe('unbounded')
    expect(snapshot.tables.widgets?.relationKind).toBe('partitioned table')
  })

  it('throws when a partitioned table has no partitionPolicies entry', () => {
    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [
            {
              table_name: 'widgets',
              relkind: 'p',
              partition_strategy: 'r',
              partition_key: 'RANGE (created_at)',
              comment: null,
            },
          ],
        }),
        emptyGrowth(),
      ),
    ).toThrow(
      'Table "widgets" is partitioned (relkind = \'p\') but has no partitionPolicies entry.',
    )
  })

  it('marks an unpartitioned table present in unboundedUnpartitionedTables as unbounded', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [
          {
            table_name: 'events',
            relkind: 'r',
            partition_strategy: '',
            partition_key: null,
            comment: null,
          },
        ],
      }),
      widgetsGrowth(),
    )

    expect(snapshot.tables.events?.partition).toBeNull()
    expect(snapshot.tables.events?.growth).toBe('unbounded')
  })

  it('classifies an unpartitioned table absent from the unbounded set as bounded', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [
          {
            table_name: 'items',
            relkind: 'r',
            partition_strategy: '',
            partition_key: null,
            comment: null,
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(snapshot.tables.items?.partition).toBeNull()
    expect(snapshot.tables.items?.growth).toBe('bounded')
  })

  it('maps hash and list physical partition strategies', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [
          {
            table_name: 'widgets',
            relkind: 'p',
            partition_strategy: 'h',
            partition_key: 'HASH (id)',
            comment: null,
          },
          {
            table_name: 'items',
            relkind: 'p',
            partition_strategy: 'l',
            partition_key: 'LIST (kind)',
            comment: null,
          },
        ],
      }),
      {
        partitionPolicies: new Map([
          ['widgets', WIDGETS_RANGE_POLICY],
          [
            'items',
            {
              strategy: 'LIST -> RANGE',
              key: 'kind',
              children: 'list-default-range',
              retentionOwner: null,
              accessClass: 'intentional-fanout',
            },
          ],
        ]),
        unboundedUnpartitionedTables: new Set(),
      },
    )

    expect(snapshot.tables.widgets?.physicalPartition).toEqual({
      strategy: 'hash',
      key: 'HASH (id)',
    })
    expect(snapshot.tables.items?.physicalPartition).toEqual({
      strategy: 'list',
      key: 'LIST (kind)',
    })
  })
})
