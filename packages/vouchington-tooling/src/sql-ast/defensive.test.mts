import { describe, expect, it, vi } from 'vitest'

describe('sql-ast defensive parse trees', () => {
  it('covers create-table empty branches', async () => {
    vi.resetModules()
    const fresh = await import('./index.mts')
    const parseSync = (sql: string) => {
      if (sql === 'empty') return {}
      if (sql === 'create') {
        return {
          stmts: [
            { stmt: undefined },
            { stmt: { SelectStmt: {} } },
            { stmt: { CreateStmt: {} } },
            { stmt: { CreateStmt: { relation: { relname: 'empty_elts' } } } },
            {
              stmt_location: 8,
              stmt: {
                CreateStmt: {
                  relation: { relname: 't' },
                  tableElts: [
                    undefined,
                    { Integer: { ival: 1 } },
                    { ColumnDef: {} },
                    { ColumnDef: { colname: 'bare' } },
                    {
                      ColumnDef: {
                        colname: 'id',
                        constraints: [undefined, { Integer: { ival: 1 } }, { Constraint: null }],
                      },
                    },
                    { Constraint: { contype: 'CONSTR_CHECK' } },
                    { Constraint: { contype: 'CONSTR_FOREIGN', fk_attrs: 'bad' } },
                    { Constraint: { contype: 'CONSTR_UNIQUE' } },
                    { Constraint: { contype: 'CONSTR_PRIMARY' } },
                    { Constraint: { contype: 'CONSTR_UNIQUE', keys: [1] } },
                    { Constraint: { contype: 'CONSTR_UNIQUE', keys: [{ Integer: { ival: 1 } }] } },
                    {
                      Constraint: {
                        contype: 'CONSTR_PRIMARY',
                        keys: [null, {}, { String: { sval: 'id' } }],
                      },
                    },
                  ],
                },
              },
            },
          ],
        }
      }
      return {}
    }
    await fresh.initSqlAst(async () => ({ loadModule: async () => undefined, parseSync }) as never)
    expect(fresh.extractCreateTableMetadata('empty')).toEqual([])
    expect(
      fresh.extractCreateTableMetadata('create').some((table) => table.tableName === 't'),
    ).toBe(true)
  })
})
