import { beforeAll, describe, expect, it } from 'vitest'
import { fkAttrNames, foreignKeyFromConstraint } from './constraint-shared.mts'
import { collectCreateStmtImplicitIndexes } from './implicit-indexes.mts'
import {
  extractCreateIndexMetadata,
  extractCreateTableMetadata,
  extractDropIndexMetadata,
  extractMigrationConstraintMetadata,
  initSqlAst,
} from './index.mts'

describe('sql-ast helpers', () => {
  beforeAll(async () => {
    await initSqlAst()
  })

  it('parses CREATE TABLE metadata including table-level primary keys', () => {
    const [table] = extractCreateTableMetadata(`
      CREATE TABLE public.table_level_pk (
        id uuid NOT NULL DEFAULT uuidv7(),
        name text,
        PRIMARY KEY (id)
      );
    `)
    expect(table?.tableName).toBe('table_level_pk')
    expect(table?.columns.find((column) => column.name === 'id')?.isPrimaryKey).toBe(true)
    expect(table?.columns.find((column) => column.name === 'name')?.isPrimaryKey).toBe(false)
  })

  it('reads generated column function names and argument columns', () => {
    const [table] = extractCreateTableMetadata(`
      CREATE TABLE public.generated (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) STORED
      );
    `)
    const createdAt = table?.columns.find((column) => column.name === 'created_at')
    expect(createdAt?.generatedFunction).toBe('uuid_extract_timestamp')
    expect(createdAt?.generatedFunctionArgColumns).toEqual(['id'])
  })

  it('extracts foreign keys, added constraints, and VALIDATE CONSTRAINT pairs', () => {
    const metadata = extractMigrationConstraintMetadata(`
      CREATE TABLE children (
        id uuid PRIMARY KEY,
        parent_id uuid REFERENCES parents(id)
      );
      ALTER TABLE children ADD CONSTRAINT chk_children CHECK (id IS NOT NULL) NOT VALID;
      ALTER TABLE children VALIDATE CONSTRAINT chk_children;
    `)
    expect(metadata.foreignKeys).toMatchObject([{ deleteAction: 'a', tableName: 'children' }])
    expect(metadata.addedConstraints).toMatchObject([
      { name: 'chk_children', tableName: 'children' },
    ])
    expect(metadata.validatedConstraints).toEqual(new Set(['children.chk_children']))
  })

  it('extracts foreign keys from ALTER TABLE inside a DO body', () => {
    const metadata = extractMigrationConstraintMetadata(`
      DO $$
      BEGIN
        ALTER TABLE children ADD CONSTRAINT children_parent_id_fkey
          FOREIGN KEY (parent_id) REFERENCES parents(id);
      END
      $$;
    `)
    expect(metadata.foreignKeys).toMatchObject([
      { tableName: 'children', referencedTableName: 'parents' },
    ])
    expect(metadata.addedConstraints).toEqual([])
  })

  it('extracts CREATE INDEX and implicit unique indexes', () => {
    const indexes = extractCreateIndexMetadata(`
      CREATE TABLE items (id uuid PRIMARY KEY, name text UNIQUE);
      CREATE INDEX items_name_lower ON items (lower(name));
    `)
    expect(indexes.some((index) => index.unique && index.indexParams.includes('id'))).toBe(true)
    expect(indexes.some((index) => index.idxname === 'items_name_lower')).toBe(true)
  })

  it('extracts DROP INDEX names', () => {
    expect(extractDropIndexMetadata('DROP INDEX IF EXISTS public.items_name_idx;')).toEqual([
      { idxname: 'items_name_idx', location: 0 },
    ])
  })

  it('extracts table-level foreign keys and unique indexes', () => {
    const sql = `
      CREATE TABLE children (
        id uuid PRIMARY KEY,
        parent_id uuid NOT NULL,
        CONSTRAINT children_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE,
        UNIQUE (parent_id)
      );
    `
    const metadata = extractMigrationConstraintMetadata(sql)
    expect(metadata.foreignKeys).toMatchObject([
      { tableName: 'children', referencedTableName: 'parents', deleteAction: 'c' },
    ])
    const indexes = extractCreateIndexMetadata(sql)
    expect(indexes.some((index) => index.unique && index.indexParams.includes('parent_id'))).toBe(
      true,
    )
  })

  it('ignores malformed create-table elements when collecting implicit indexes', () => {
    const indexes: ReturnType<typeof extractCreateIndexMetadata> = []
    collectCreateStmtImplicitIndexes({}, 0, indexes)
    collectCreateStmtImplicitIndexes({ relation: { relname: 't' }, tableElts: 'nope' }, 0, indexes)
    collectCreateStmtImplicitIndexes(
      {
        relation: { relname: 't' },
        tableElts: [
          1,
          { ColumnDef: {} },
          {
            ColumnDef: {
              colname: 'id',
              constraints: [1, { Constraint: { contype: 'CONSTR_CHECK' } }],
            },
          },
          { Constraint: { contype: 'CONSTR_CHECK' } },
          { Constraint: { contype: 'CONSTR_UNIQUE' } },
        ],
      },
      0,
      indexes,
    )
    expect(indexes).toEqual([])
  })

  it('treats malformed constraint records as empty foreign-key metadata', () => {
    expect(fkAttrNames({})).toEqual([])
    expect(fkAttrNames({ fk_attrs: [{ Integer: { ival: 1 } }] })).toEqual([])
    expect(foreignKeyFromConstraint({}, null, [])).toEqual({
      columnNames: [],
      deleteAction: null,
      location: 0,
      referencedTableName: null,
      tableName: null,
    })
  })

  it('extracts CREATE INDEX include columns, predicates, and opclasses', () => {
    const indexes = extractCreateIndexMetadata(`
      CREATE INDEX items_name_idx ON items USING btree (name text_ops DESC NULLS LAST)
        INCLUDE (id) WHERE name IS NOT NULL;
    `)
    const index = indexes.find((entry) => entry.idxname === 'items_name_idx')
    expect(index).toMatchObject({
      relname: 'items',
      unique: false,
      includeParams: ['id'],
      accessMethod: 'btree',
    })
    expect(index?.indexParamDetails[0]).toMatchObject({
      name: 'name',
      opclass: 'text_ops',
    })
    expect(index?.whereClauseKey).toEqual(expect.any(String))
  })
})
