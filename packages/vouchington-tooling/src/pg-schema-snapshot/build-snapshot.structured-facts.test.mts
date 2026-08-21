import { describe, expect, it } from 'vitest'

import { buildSchemaSnapshot } from './build-snapshot.mts'
import { catalog, emptyGrowth, widgetsCatalogTable } from './snapshot.test-helpers.mts'

describe('buildSchemaSnapshot — v2 structured catalog facts', () => {
  it('writes format version 2 and separates generated and default expressions', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [widgetsCatalogTable()],
        columns: [
          {
            table_name: 'widgets',
            column_name: 'created_at',
            data_type: 'timestamp with time zone',
            nullable: false,
            default_expression: 'now()',
            identity: '',
            generated: '',
            collation: null,
            comment: null,
            ordinal_position: 1,
          },
          {
            table_name: 'widgets',
            column_name: 'search_text',
            data_type: 'text',
            nullable: false,
            default_expression: "to_tsvector('english'::regconfig, name)",
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

    expect(snapshot.formatVersion).toBe(2)
    expect(snapshot.tables.widgets?.columns).toMatchObject({
      created_at: { defaultExpression: 'now()', generatedExpression: null },
      search_text: {
        defaultExpression: null,
        generatedExpression: "to_tsvector('english'::regconfig, name)",
      },
    })
  })

  it('preserves constraint definitions with structured key and foreign-key facts', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [widgetsCatalogTable()],
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
            column_name: 'owner_id',
            data_type: 'uuid',
            nullable: false,
            default_expression: null,
            identity: '',
            generated: '',
            collation: null,
            comment: null,
            ordinal_position: 2,
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
            constraint_name: 'widgets_owner_fkey',
            contype: 'f',
            definition: 'FOREIGN KEY (owner_id) REFERENCES items(id) ON DELETE CASCADE',
            columns: ['owner_id'],
            referenced_table: 'items',
            referenced_columns: ['id'],
            on_update: 'no action',
            on_delete: 'cascade',
            validated: false,
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(snapshot.tables.widgets?.primaryKey).toEqual({
      definition: 'PRIMARY KEY (id)',
      columns: ['id'],
    })
    expect(snapshot.tables.widgets?.foreignKeys.widgets_owner_fkey).toEqual({
      definition: 'FOREIGN KEY (owner_id) REFERENCES items(id) ON DELETE CASCADE',
      columns: ['owner_id'],
      referencedTable: 'items',
      referencedColumns: ['id'],
      onUpdate: 'no action',
      onDelete: 'cascade',
      validated: false,
    })
  })

  it('preserves index definitions with ordered physical index metadata', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [widgetsCatalogTable()],
        indexes: [
          {
            table_name: 'widgets',
            index_name: 'idx_widgets__search',
            definition: 'CREATE INDEX idx_widgets__search ON widgets USING gin (search_text)',
            access_method: 'gin',
            unique: false,
            primary: false,
            constraint_backed: false,
            valid: true,
            ready: true,
            keys: [
              {
                column: 'search_text',
                expression: 'search_text',
                opclass: 'tsvector_ops',
                descending: false,
                nulls_first: false,
              },
            ],
            included_columns: ['id'],
            predicate: 'archived_at IS NULL',
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(snapshot.tables.widgets?.indexes.idx_widgets__search).toEqual({
      definition: 'CREATE INDEX idx_widgets__search ON widgets USING gin (search_text)',
      accessMethod: 'gin',
      unique: false,
      primary: false,
      constraintBacked: false,
      valid: true,
      ready: true,
      keys: [
        {
          column: 'search_text',
          expression: 'search_text',
          opclass: 'tsvector_ops',
          descending: false,
          nullsFirst: false,
        },
      ],
      includedColumns: ['id'],
      predicate: 'archived_at IS NULL',
    })
  })

  it('distinguishes declared partition policy from physical partition facts', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({ tables: [widgetsCatalogTable()] }),
      emptyGrowth(),
    )

    expect(snapshot.tables.widgets).toMatchObject({
      relationKind: 'table',
      physicalPartition: null,
      partition: null,
    })
  })

  it('sorts keyed output and rejects inconsistent catalog facts', () => {
    const snapshot = buildSchemaSnapshot(
      catalog({
        tables: [
          { ...widgetsCatalogTable(), table_name: 'zebras' },
          { ...widgetsCatalogTable(), table_name: 'aardvarks' },
        ],
      }),
      emptyGrowth(),
    )

    expect(Object.keys(snapshot.tables)).toEqual(['aardvarks', 'zebras'])
    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [widgetsCatalogTable()],
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
          ],
          constraints: [
            {
              table_name: 'widgets',
              constraint_name: 'widgets_pkey',
              contype: 'p',
              definition: 'PRIMARY KEY (missing)',
              columns: ['missing'],
              referenced_table: null,
              referenced_columns: [],
              on_update: null,
              on_delete: null,
              validated: true,
            },
          ],
        }),
        emptyGrowth(),
      ),
    ).toThrow(/widgets_pkey.*missing/u)
  })
})
