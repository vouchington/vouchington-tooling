import { describe, expect, it } from 'vitest'

import {
  readColumns,
  readConstraints,
  readEnums,
  readExtensions,
  readFunctions,
  readIndexes,
  readPolicies,
  readSchemaCatalog,
  readTables,
  readTriggers,
  readViews,
} from './catalog-queries.mts'
import type { CatalogQuery } from './types.mts'

describe('catalog readers', () => {
  it('issue parameterized catalog SQL through the injected query', async () => {
    const sql: string[] = []
    const query: CatalogQuery = async (text) => {
      sql.push(text)
      return { rows: [] }
    }
    const catalog = await readSchemaCatalog(query)
    expect(catalog).toEqual({
      tables: [],
      columns: [],
      constraints: [],
      indexes: [],
      triggers: [],
      enums: [],
      views: [],
      extensions: [],
      functions: [],
      policies: [],
    })
    expect(sql).toHaveLength(10)
    expect(sql.join('\n')).toMatch(/readSchemaSnapshotTables/)
    expect(sql.join('\n')).toMatch(/readSchemaSnapshotColumns/)
    expect(sql.join('\n')).toMatch(/pg_attribute\.atttypmod/)
    expect(sql.join('\n')).not.toMatch(/atttypemod/)
    expect(sql.join('\n')).toMatch(/pg_inherits/)
    expect(sql.join('\n')).toMatch(/pg_depend/)
  })

  it('returns rows from each reader', async () => {
    const query: CatalogQuery = async <Row extends Record<string, unknown>>() => ({
      rows: [{ ok: true }] as unknown as Row[],
    })
    await expect(readTables(query)).resolves.toEqual([{ ok: true }])
    await expect(readColumns(query)).resolves.toEqual([{ ok: true }])
    await expect(readConstraints(query)).resolves.toEqual([{ ok: true }])
    await expect(readIndexes(query)).resolves.toEqual([{ ok: true }])
    await expect(readTriggers(query)).resolves.toEqual([{ ok: true }])
    await expect(readEnums(query)).resolves.toEqual([{ ok: true }])
    await expect(readViews(query)).resolves.toEqual([{ ok: true }])
    await expect(readExtensions(query)).resolves.toEqual([{ ok: true }])
    await expect(readFunctions(query)).resolves.toEqual([{ ok: true }])
    await expect(readPolicies(query)).resolves.toEqual([{ ok: true }])
  })
})
