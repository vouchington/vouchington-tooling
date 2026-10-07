import { beforeAll, describe, expect, it, vi } from 'vitest'
import { extractViewDeclarations, initSqlAst } from './index.mts'

describe('extractViewDeclarations', () => {
  beforeAll(() => initSqlAst())

  it('ignores comments and literals while preserving recursive, temporary, and quoted names', () => {
    expect(
      extractViewDeclarations(`
        -- CREATE OR REPLACE VIEW ignored_line AS SELECT 1;
        SELECT 'CREATE OR REPLACE VIEW ignored_string AS SELECT 1';
        SELECT 'don''t CREATE OR REPLACE VIEW ignored_escaped_string AS SELECT 1';
        /* CREATE OR REPLACE VIEW ignored_block AS SELECT 1; */
        CREATE OR REPLACE VIEW public.visible_view AS SELECT 1;
        CREATE OR REPLACE TEMP VIEW "quoted schema"."quoted.view" AS SELECT 2;
        CREATE OR REPLACE VIEW "quoted "" identifier" AS SELECT 3;
        CREATE OR REPLACE RECURSIVE VIEW recursive_view(x) AS SELECT 3 AS x;
      `).map(({ name }) => name),
    ).toEqual([
      'public.visible_view',
      '"quoted schema"."quoted.view"',
      '"quoted "" identifier"',
      'recursive_view',
    ])
  })

  it('returns typed materialized views and ordinary views but omits tables', () => {
    expect(
      extractViewDeclarations(`
        CREATE MATERIALIZED VIEW "quoted schema"."quoted.matview" AS SELECT 1;
        CREATE TABLE ordinary_table AS SELECT 1;
        CREATE VIEW ordinary_view AS SELECT 1;
      `),
    ).toEqual([
      { name: '"quoted schema"."quoted.matview"', type: 'materialized view' },
      { name: 'ordinary_view', type: 'view' },
    ])
  })

  it('returns no declarations for malformed SQL or blank input', () => {
    expect(extractViewDeclarations('CREATE TABLE (')).toEqual([])
    expect(extractViewDeclarations('  ')).toEqual([])
  })

  it('ignores incomplete parser nodes without producing declarations', async () => {
    vi.resetModules()
    const fresh = await import('./index.mts')
    const parseSync = (sql: string) =>
      sql === 'empty'
        ? {}
        : {
            stmts: [
              { stmt: undefined },
              { stmt: { SelectStmt: {} } },
              { stmt: { ViewStmt: {} } },
              { stmt: { ViewStmt: { view: {} } } },
              { stmt: { CreateTableAsStmt: { objtype: 'OBJECT_TABLE' } } },
              { stmt: { CreateTableAsStmt: { objtype: 'OBJECT_MATVIEW' } } },
              { stmt: { CreateTableAsStmt: { objtype: 'OBJECT_MATVIEW', into: { rel: {} } } } },
            ],
          }
    await fresh.initSqlAst(async () => ({ loadModule: async () => undefined, parseSync }) as never)
    expect(fresh.extractViewDeclarations('empty')).toEqual([])
    expect(fresh.extractViewDeclarations('tree')).toEqual([])
  })
})
