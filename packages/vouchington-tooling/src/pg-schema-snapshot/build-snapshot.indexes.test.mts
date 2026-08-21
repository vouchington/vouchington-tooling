import { describe, expect, it } from 'vitest'

import { buildSchemaSnapshot } from './build-snapshot.mts'
import { catalog, emptyGrowth } from './snapshot.test-helpers.mts'

describe('buildSchemaSnapshot — indexes', () => {
  it('groups indexes and triggers under their table, keyed by name', () => {
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
        indexes: [
          {
            table_name: 'widgets',
            index_name: 'idx_widgets__owner_id',
            definition: 'CREATE INDEX idx_widgets__owner_id ON widgets USING btree (owner_id)',
            access_method: 'btree',
            unique: false,
            primary: false,
            constraint_backed: false,
            valid: true,
            ready: true,
            keys: [
              {
                column: 'owner_id',
                expression: 'owner_id',
                opclass: 'uuid_ops',
                descending: false,
                nulls_first: false,
              },
            ],
            included_columns: [],
            predicate: null,
          },
        ],
        triggers: [
          {
            table_name: 'widgets',
            trigger_name: 'widgets_set_updated_at',
            definition:
              'CREATE TRIGGER widgets_set_updated_at BEFORE UPDATE ON widgets FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          },
        ],
      }),
      emptyGrowth(),
    )

    expect(snapshot.tables.widgets?.indexes).toEqual({
      idx_widgets__owner_id: {
        definition: 'CREATE INDEX idx_widgets__owner_id ON widgets USING btree (owner_id)',
        accessMethod: 'btree',
        unique: false,
        primary: false,
        constraintBacked: false,
        valid: true,
        ready: true,
        keys: [
          {
            column: 'owner_id',
            expression: 'owner_id',
            opclass: 'uuid_ops',
            descending: false,
            nullsFirst: false,
          },
        ],
        includedColumns: [],
        predicate: null,
      },
    })
    expect(snapshot.tables.widgets?.triggers).toEqual({
      widgets_set_updated_at:
        'CREATE TRIGGER widgets_set_updated_at BEFORE UPDATE ON widgets FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
    })
  })
})
