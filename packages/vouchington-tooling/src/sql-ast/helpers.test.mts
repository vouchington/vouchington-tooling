import { beforeAll, describe, expect, it } from 'vitest'
import { extractCreateTableMetadata, initSqlAst } from './index.mts'

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
})
