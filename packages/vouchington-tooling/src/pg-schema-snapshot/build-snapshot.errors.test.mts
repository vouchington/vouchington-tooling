import { describe, expect, it } from 'vitest'

import { buildSchemaSnapshot } from './build-snapshot.mts'
import {
  catalog,
  columnRow,
  emptyGrowth,
  widgetsCatalogTable,
  widgetsGrowth,
} from './snapshot.test-helpers.mts'

describe('buildSchemaSnapshot — catalog consistency errors', () => {
  it('rejects catalog rows that reference an unknown table', () => {
    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [widgetsCatalogTable()],
          columns: [columnRow('items', 'id')],
        }),
        emptyGrowth(),
      ),
    ).toThrow('Catalog row references unknown table "items".')
  })

  it('rejects duplicate column, constraint, index, and trigger names', () => {
    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [widgetsCatalogTable()],
          columns: [
            columnRow('widgets', 'id'),
            columnRow('widgets', 'id', { ordinal_position: 2 }),
          ],
        }),
        emptyGrowth(),
      ),
    ).toThrow('Catalog contains duplicate column_name "widgets.id".')

    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [widgetsCatalogTable()],
          constraints: [
            {
              table_name: 'widgets',
              constraint_name: 'widgets_check',
              contype: 'c',
              definition: 'CHECK (true)',
              columns: [],
              referenced_table: null,
              referenced_columns: [],
              on_update: null,
              on_delete: null,
              validated: true,
            },
            {
              table_name: 'widgets',
              constraint_name: 'widgets_check',
              contype: 'c',
              definition: 'CHECK (false)',
              columns: [],
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
    ).toThrow('Catalog contains duplicate constraint_name "widgets.widgets_check".')

    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [widgetsCatalogTable()],
          indexes: [
            {
              table_name: 'widgets',
              index_name: 'idx_widgets',
              definition: 'CREATE INDEX idx_widgets ON widgets USING btree (id)',
              access_method: 'btree',
              unique: false,
              primary: false,
              constraint_backed: false,
              valid: true,
              ready: true,
              keys: [],
              included_columns: [],
              predicate: null,
            },
            {
              table_name: 'widgets',
              index_name: 'idx_widgets',
              definition: 'CREATE INDEX idx_widgets ON widgets USING btree (id)',
              access_method: 'btree',
              unique: false,
              primary: false,
              constraint_backed: false,
              valid: true,
              ready: true,
              keys: [],
              included_columns: [],
              predicate: null,
            },
          ],
        }),
        emptyGrowth(),
      ),
    ).toThrow('Catalog contains duplicate index_name "widgets.idx_widgets".')

    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [widgetsCatalogTable()],
          triggers: [
            {
              table_name: 'widgets',
              trigger_name: 'widgets_touch',
              definition: 'CREATE TRIGGER widgets_touch ...',
            },
            {
              table_name: 'widgets',
              trigger_name: 'widgets_touch',
              definition: 'CREATE TRIGGER widgets_touch ...',
            },
          ],
        }),
        emptyGrowth(),
      ),
    ).toThrow('Catalog contains duplicate trigger_name "widgets.widgets_touch".')
  })

  it('rejects a physically partitioned table with no partition key', () => {
    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [
            {
              table_name: 'widgets',
              relkind: 'p',
              partition_strategy: 'r',
              partition_key: null,
              comment: null,
            },
          ],
        }),
        widgetsGrowth(),
      ),
    ).toThrow('A physically partitioned table must have a partition key.')
  })

  it('rejects inconsistent relation kind and physical partition facts', () => {
    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [
            {
              table_name: 'widgets',
              relkind: 'r',
              partition_strategy: 'r',
              partition_key: 'RANGE (id)',
              comment: null,
            },
          ],
        }),
        emptyGrowth(),
      ),
    ).toThrow('Table "widgets" has inconsistent relation kind and physical partition facts.')

    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [
            {
              table_name: 'widgets',
              relkind: 'p',
              partition_strategy: '',
              partition_key: null,
              comment: null,
            },
          ],
        }),
        widgetsGrowth(),
      ),
    ).toThrow('Table "widgets" has inconsistent relation kind and physical partition facts.')
  })

  it('rejects a foreign key missing referenced-table facts', () => {
    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [widgetsCatalogTable()],
          columns: [columnRow('widgets', 'owner_id')],
          constraints: [
            {
              table_name: 'widgets',
              constraint_name: 'widgets_owner_fkey',
              contype: 'f',
              definition: 'FOREIGN KEY (owner_id) REFERENCES items(id)',
              columns: ['owner_id'],
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
    ).toThrow('Foreign key "widgets_owner_fkey" is missing referenced-table facts.')
  })

  it('rejects unique constraints that reference unknown columns', () => {
    expect(() =>
      buildSchemaSnapshot(
        catalog({
          tables: [widgetsCatalogTable()],
          columns: [columnRow('widgets', 'id')],
          constraints: [
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
          ],
        }),
        emptyGrowth(),
      ),
    ).toThrow('Constraint "widgets_slug_key" on "widgets" references unknown column "slug".')
  })
})
