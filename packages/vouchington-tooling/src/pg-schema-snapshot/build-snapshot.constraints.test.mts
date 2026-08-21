import { describe, expect, it } from 'vitest'

import { buildSchemaSnapshot } from './build-snapshot.mts'
import { catalog, emptyGrowth } from './snapshot.test-helpers.mts'

describe('buildSchemaSnapshot — constraints', () => {
  it('routes constraints by contype into primaryKey, uniqueConstraints, checkConstraints, foreignKeys', () => {
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
            column_name: 'id',
            data_type: 'uuid',
            nullable: false,
            default_expression: null,
            identity: '',
            generated: '',
            collation: null,
            comment: null,
            ordinal_position: 1,
          },
          {
            table_name: 'widgets',
            column_name: 'slug',
            data_type: 'text',
            nullable: false,
            default_expression: null,
            identity: '',
            generated: '',
            collation: null,
            comment: null,
            ordinal_position: 2,
          },
          {
            table_name: 'widgets',
            column_name: 'owner_id',
            data_type: 'uuid',
            nullable: false,
            default_expression: null,
            identity: '',
            generated: '',
            collation: null,
            comment: null,
            ordinal_position: 3,
          },
        ],
        constraints: [
          {
            table_name: 'widgets',
            constraint_name: 'widgets_pkey',
            contype: 'p',
            definition: 'PRIMARY KEY (id)',
            columns: ['id'],
            referenced_table: null,
            referenced_columns: [],
            on_update: null,
            on_delete: null,
            validated: true,
          },
          {
            table_name: 'widgets',
            constraint_name: 'widgets_slug_key',
            contype: 'u',
            definition: 'UNIQUE (slug)',
            columns: ['slug'],
            referenced_table: null,
            referenced_columns: [],
            on_update: null,
            on_delete: null,
            validated: true,
          },
          {
            table_name: 'widgets',
            constraint_name: 'widgets_total_check',
            contype: 'c',
            definition: 'CHECK (total >= 0)',
            columns: [],
            referenced_table: null,
            referenced_columns: [],
            on_update: null,
            on_delete: null,
            validated: true,
          },
          {
            table_name: 'widgets',
            constraint_name: 'widgets_owner_fkey',
            contype: 'f',
            definition: 'FOREIGN KEY (owner_id) REFERENCES items(id) ON DELETE CASCADE',
            columns: ['owner_id'],
            referenced_table: 'items',
            referenced_columns: ['id'],
            on_update: 'no action',
            on_delete: 'cascade',
            validated: true,
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(snapshot.tables.widgets).toMatchObject({
      primaryKey: { definition: 'PRIMARY KEY (id)', columns: ['id'] },
      uniqueConstraints: { widgets_slug_key: { definition: 'UNIQUE (slug)', columns: ['slug'] } },
      checkConstraints: { widgets_total_check: 'CHECK (total >= 0)' },
      foreignKeys: {
        widgets_owner_fkey: {
          definition: 'FOREIGN KEY (owner_id) REFERENCES items(id) ON DELETE CASCADE',
          columns: ['owner_id'],
          referencedTable: 'items',
          referencedColumns: ['id'],
          onUpdate: 'no action',
          onDelete: 'cascade',
          validated: true,
        },
      },
    })
  })
})
