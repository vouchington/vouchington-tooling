import { beforeAll, describe, expect, it, vi } from 'vitest'
import { extractAlterTableAddColumnLocations, initSqlAst, lineOfUtf8ByteOffset } from './index.mts'

describe('sql-ast', () => {
  beforeAll(async () => {
    await initSqlAst()
  })

  it('is idempotent when initSqlAst is called twice', async () => {
    await expect(initSqlAst()).resolves.toBeUndefined()
  })

  it('extracts ALTER TABLE ADD column locations with optional syntax', () => {
    const content = [
      'ALTER TABLE users',
      '  ADD IF NOT EXISTS locale text,',
      '  ADD COLUMN timezone text;',
    ].join('\n')

    expect(
      extractAlterTableAddColumnLocations(content).map((location) =>
        lineOfUtf8ByteOffset(content, location),
      ),
    ).toEqual([1, 1])
  })

  it('ignores statements that are not ALTER TABLE ADD COLUMN', () => {
    expect(extractAlterTableAddColumnLocations('SELECT 1;')).toEqual([])
    expect(extractAlterTableAddColumnLocations('ALTER TABLE users DROP COLUMN locale;')).toEqual([])
  })

  it('computes utf-8 line numbers from parser byte offsets', () => {
    const content = 'line one\nline two →\nline three'
    expect(lineOfUtf8ByteOffset(content, 0)).toBe(1)
    expect(lineOfUtf8ByteOffset(Buffer.from(content, 'utf8'), content.indexOf('two'))).toBe(2)
  })

  it('throws when the byte offset is past the end of the content buffer', () => {
    const content = 'CREATE TABLE public."Overflow" (\n  note text -- arrow →\n);'
    expect(() => lineOfUtf8ByteOffset(content, Buffer.from(content, 'utf8').length + 1)).toThrow(
      RangeError,
    )
  })
})

describe('sql-ast loader errors', () => {
  it('requires initSqlAst before parse helpers', async () => {
    vi.resetModules()
    const fresh = await import('./index.mts')
    expect(() => fresh.extractAlterTableAddColumnLocations('SELECT 1;')).toThrow(
      'initSqlAst() must be awaited before calling parse helpers',
    )
  })

  it('wraps a missing parser package', async () => {
    vi.resetModules()
    const fresh = await import('./index.mts')
    await expect(
      fresh.initSqlAst(() =>
        Promise.reject(
          Object.assign(new Error('Cannot find package'), { code: 'ERR_MODULE_NOT_FOUND' }),
        ),
      ),
    ).rejects.toBeInstanceOf(fresh.MissingSqlAstParserError)
  })

  it('rethrows unexpected parser import failures', async () => {
    vi.resetModules()
    const fresh = await import('./index.mts')
    await expect(fresh.initSqlAst(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
  })

  it('covers defensive parse-tree branches with a fake parser', async () => {
    vi.resetModules()
    const fresh = await import('./index.mts')
    const parseSync = (sql: string) => {
      if (sql === 'empty') return {}
      return {
        stmts: [
          { stmt: undefined },
          { stmt: { SelectStmt: {} } },
          { stmt: { AlterTableStmt: {} } },
          {
            stmt: {
              AlterTableStmt: {
                cmds: [
                  undefined,
                  { SelectStmt: {} },
                  { AlterTableCmd: { subtype: 'AT_DropColumn' } },
                  { AlterTableCmd: { subtype: 'AT_AddColumn' } },
                  { AlterTableCmd: { subtype: 'AT_AddColumn', def: { Integer: { ival: 1 } } } },
                  { AlterTableCmd: { subtype: 'AT_AddColumn', def: { ColumnDef: {} } } },
                ],
              },
            },
          },
        ],
      }
    }
    await fresh.initSqlAst(async () => ({ loadModule: async () => undefined, parseSync }) as never)
    expect(fresh.extractAlterTableAddColumnLocations('empty')).toEqual([])
    expect(fresh.extractAlterTableAddColumnLocations('tree')).toEqual([0])
  })

  it('maps module-not-found only when the import error has that code', async () => {
    vi.resetModules()
    const fresh = await import('./index.mts')
    await expect(fresh.initSqlAst(() => Promise.reject('nope'))).rejects.toBe('nope')
    await expect(fresh.initSqlAst(() => Promise.reject(null))).rejects.toBeNull()
    await expect(
      fresh.initSqlAst(() => Promise.reject(Object.assign(new Error('x'), { code: 'OTHER' }))),
    ).rejects.toThrow('x')
  })

  it('clears loader state when initSqlAst fails', async () => {
    vi.resetModules()
    const fresh = await import('./index.mts')
    await expect(fresh.initSqlAst(() => Promise.reject(new Error('load failed')))).rejects.toThrow(
      'load failed',
    )
    await expect(fresh.initSqlAst()).resolves.toBeUndefined()
  })
})
