import { describe, expect, it } from 'vitest'

import { buildSchemaSnapshot } from './build-snapshot.mts'
import { catalog, emptyCatalog, emptyGrowth } from './snapshot.test-helpers.mts'

describe('buildSchemaSnapshot — columns', () => {
  it('returns an all-empty snapshot for an empty catalog', () => {
    expect(buildSchemaSnapshot(emptyCatalog(), emptyGrowth())).toEqual({
      formatVersion: 2,
      tables: {},
      views: {},
      enums: {},
      extensions: {},
      functions: {},
      policies: {},
    })
  })

  it('groups columns under their table and maps identity/generated codes', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [
          {
            table_name: 'widgets',
            relkind: 'r',
            partition_strategy: '',
            partition_key: null,
            comment: 'A bounded table.',
          },
        ],
        columns: [
          {
            table_name: 'widgets',
            column_name: 'id',
            data_type: 'uuid',
            nullable: false,
            default_expression: null,
            identity: 'a',
            generated: '',
            collation: null,
            comment: 'Primary identifier.',
            ordinal_position: 1,
          },
          {
            table_name: 'widgets',
            column_name: 'total',
            data_type: 'integer',
            nullable: true,
            default_expression: '0',
            identity: '',
            generated: 's',
            collation: null,
            comment: null,
            ordinal_position: 2,
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(snapshot.tables.widgets).toEqual({
      columns: {
        id: {
          type: 'uuid',
          nullable: false,
          defaultExpression: null,
          generatedExpression: null,
          identity: 'always',
          generated: null,
          collation: null,
          comment: 'Primary identifier.',
          ordinalPosition: 1,
        },
        total: {
          type: 'integer',
          nullable: true,
          defaultExpression: null,
          generatedExpression: '0',
          identity: null,
          generated: 'stored',
          collation: null,
          comment: null,
          ordinalPosition: 2,
        },
      },
      relationKind: 'table',
      primaryKey: null,
      uniqueConstraints: {},
      checkConstraints: {},
      foreignKeys: {},
      indexes: {},
      triggers: {},
      comment: 'A bounded table.',
      physicalPartition: null,
      partition: null,
      growth: 'bounded',
    })
  })

  it('maps identity code "d" to "by default" and generated code "v" to "virtual"', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [
          {
            table_name: 'widgets',
            relkind: 'r',
            partition_strategy: '',
            partition_key: null,
            comment: null,
          },
        ],
        columns: [
          {
            table_name: 'widgets',
            column_name: 'sequence_number',
            data_type: 'integer',
            nullable: false,
            default_expression: null,
            identity: 'd',
            generated: '',
            collation: null,
            comment: null,
            ordinal_position: 1,
          },
          {
            table_name: 'widgets',
            column_name: 'derived',
            data_type: 'text',
            nullable: true,
            default_expression: null,
            identity: '',
            generated: 'v',
            collation: null,
            comment: null,
            ordinal_position: 2,
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(snapshot.tables.widgets?.columns.sequence_number?.identity).toBe('by default')
    expect(snapshot.tables.widgets?.columns.derived?.generated).toBe('virtual')
  })

  it('sorts columns with equal ordinal positions by name', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [
          {
            table_name: 'widgets',
            relkind: 'r',
            partition_strategy: '',
            partition_key: null,
            comment: null,
          },
        ],
        columns: [
          {
            table_name: 'widgets',
            column_name: 'zeta',
            data_type: 'text',
            nullable: true,
            default_expression: null,
            identity: '',
            generated: '',
            collation: null,
            comment: null,
            ordinal_position: 1,
          },
          {
            table_name: 'widgets',
            column_name: 'alpha',
            data_type: 'text',
            nullable: true,
            default_expression: null,
            identity: '',
            generated: '',
            collation: null,
            comment: null,
            ordinal_position: 1,
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(Object.keys(snapshot.tables.widgets?.columns ?? {})).toEqual(['alpha', 'zeta'])
  })
})
