import { describe, expect, it, vi } from 'vitest'

describe('sql-ast defensive parse trees', () => {
  it('covers create-table, constraint, index, and drop-index empty branches', async () => {
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
            {
              stmt: {
                CreateStmt: {
                  relation: { relname: 't' },
                  tableElts: [
                    undefined,
                    { Integer: { ival: 1 } },
                    { ColumnDef: {} },
                    {
                      ColumnDef: {
                        colname: 'id',
                        constraints: [undefined, { Integer: { ival: 1 } }, { Constraint: null }],
                      },
                    },
                    { Constraint: { contype: 'CONSTR_CHECK' } },
                    { Constraint: { contype: 'CONSTR_FOREIGN', fk_attrs: 'bad' } },
                    { Constraint: { contype: 'CONSTR_UNIQUE' } },
                    { Constraint: { contype: 'CONSTR_UNIQUE', keys: [{ Integer: { ival: 1 } }] } },
                    {
                      Constraint: { contype: 'CONSTR_PRIMARY', keys: [{ String: { sval: 'id' } }] },
                    },
                  ],
                },
              },
            },
          ],
        }
      }
      if (sql === 'alter') {
        return {
          stmts: [
            {
              stmt: {
                AlterTableStmt: {
                  relation: { relname: 't' },
                  cmds: [
                    undefined,
                    { SelectStmt: {} },
                    { AlterTableCmd: { subtype: 'AT_DropColumn' } },
                    { AlterTableCmd: { subtype: 'AT_AddConstraint' } },
                    {
                      AlterTableCmd: { subtype: 'AT_AddConstraint', def: { Integer: { ival: 1 } } },
                    },
                    {
                      AlterTableCmd: {
                        subtype: 'AT_ValidateConstraint',
                        name: 'chk',
                      },
                    },
                  ],
                },
              },
            },
            { stmt: { DoStmt: { args: [undefined, { DefElem: {} }] } } },
          ],
        }
      }
      if (sql === 'drop') {
        return {
          stmts: [
            { stmt: { DropStmt: { removeType: 'OBJECT_TABLE' } } },
            {
              stmt: {
                DropStmt: {
                  removeType: 'OBJECT_INDEX',
                  objects: [
                    undefined,
                    { List: {} },
                    { List: { items: [{ Integer: { ival: 1 } }] } },
                  ],
                },
              },
            },
          ],
        }
      }
      return {
        stmts: [
          { stmt: { IndexStmt: {} } },
          {
            stmt: {
              IndexStmt: {
                relation: { relname: 't' },
                indexParams: [
                  undefined,
                  { IndexElem: { name: 'n', opclass: [{ String: { sval: 'ops' } }] } },
                ],
              },
            },
          },
        ],
      }
    }
    await fresh.initSqlAst(async () => ({ loadModule: async () => undefined, parseSync }) as never)
    expect(fresh.extractCreateTableMetadata('empty')).toEqual([])
    expect(
      fresh.extractCreateTableMetadata('create').some((table) => table.tableName === 't'),
    ).toBe(true)
    expect(fresh.extractMigrationConstraintMetadata('empty')).toMatchObject({ foreignKeys: [] })
    expect(
      fresh.extractMigrationConstraintMetadata('alter').validatedConstraints.has('t.chk'),
    ).toBe(true)
    expect(fresh.extractDropIndexMetadata('empty')).toEqual([])
    expect(fresh.extractDropIndexMetadata('drop')).toEqual([])
    expect(fresh.extractCreateIndexMetadata('empty')).toEqual([])
    expect(fresh.extractCreateIndexMetadata('index').some((index) => index.relname === 't')).toBe(
      true,
    )
  })
})
