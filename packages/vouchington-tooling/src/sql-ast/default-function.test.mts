import type { Node } from '@libpg-query/parser'
import { describe, expect, it } from 'vitest'

import { extractDefaultFunction, extractFuncCallArgColumnNames } from './default-function.mts'

describe('extractDefaultFunction', () => {
  it('returns null when there is no raw_expr', () => {
    expect(extractDefaultFunction(undefined)).toBeNull()
  })

  it('lowercases the last segment of a FuncCall default', () => {
    const now: Node = { FuncCall: { funcname: [{ String: { sval: 'NOW' } }] } }
    expect(extractDefaultFunction(now)).toBe('now')

    const uuidv7: Node = {
      FuncCall: { funcname: [{ String: { sval: 'pg_catalog' } }, { String: { sval: 'uuidv7' } }] },
    }
    expect(extractDefaultFunction(uuidv7)).toBe('uuidv7')
  })

  it('returns null for a FuncCall with no funcname segments', () => {
    expect(extractDefaultFunction({ FuncCall: {} })).toBeNull()
    expect(extractDefaultFunction({ FuncCall: { funcname: [] } })).toBeNull()
  })

  it('returns null when the last funcname segment is not a String', () => {
    const node: Node = { FuncCall: { funcname: [{ Integer: { ival: 0 } }] } }
    expect(extractDefaultFunction(node)).toBeNull()
  })

  it('returns null when the last funcname String has no sval', () => {
    const node: Node = { FuncCall: { funcname: [{ String: {} }] } }
    expect(extractDefaultFunction(node)).toBeNull()
  })

  it('maps a SQLValueFunction CURRENT_TIMESTAMP to current_timestamp', () => {
    const node: Node = { SQLValueFunction: { op: 'SVFOP_CURRENT_TIMESTAMP' } }
    expect(extractDefaultFunction(node)).toBe('current_timestamp')
  })

  it('returns null for other SQLValueFunction ops', () => {
    const node: Node = { SQLValueFunction: { op: 'SVFOP_CURRENT_DATE' } }
    expect(extractDefaultFunction(node)).toBeNull()
  })

  it('returns null for a node that is neither FuncCall nor SQLValueFunction', () => {
    const node: Node = { Integer: { ival: 0 } }
    expect(extractDefaultFunction(node)).toBeNull()
  })

  it('unwraps a TypeCast to resolve the inner default function', () => {
    const node: Node = {
      TypeCast: {
        arg: { FuncCall: { funcname: [{ String: { sval: 'now' } }] } },
      },
    }
    expect(extractDefaultFunction(node)).toBe('now')
  })

  it('returns null when a TypeCast has no inner arg', () => {
    const node: Node = { TypeCast: {} }
    expect(extractDefaultFunction(node)).toBeNull()
  })
})

describe('extractFuncCallArgColumnNames', () => {
  it('returns an empty array when there is no raw_expr', () => {
    expect(extractFuncCallArgColumnNames(undefined)).toEqual([])
  })

  it('returns lowercased column names referenced by a FuncCall', () => {
    const node: Node = {
      FuncCall: {
        funcname: [{ String: { sval: 'uuid_extract_timestamp' } }],
        args: [{ ColumnRef: { fields: [{ String: { sval: 'ID' } }] } }],
      },
    }
    expect(extractFuncCallArgColumnNames(node)).toEqual(['id'])
  })

  it('unwraps a TypeCast to resolve the inner FuncCall args', () => {
    const node: Node = {
      TypeCast: {
        arg: {
          FuncCall: {
            funcname: [{ String: { sval: 'uuid_extract_timestamp' } }],
            args: [{ ColumnRef: { fields: [{ String: { sval: 'id' } }] } }],
          },
        },
      },
    }
    expect(extractFuncCallArgColumnNames(node)).toEqual(['id'])
  })

  it('returns an empty array for a FuncCall with no args', () => {
    expect(
      extractFuncCallArgColumnNames({
        FuncCall: { funcname: [{ String: { sval: 'now' } }] },
      }),
    ).toEqual([])
  })

  it('skips non-ColumnRef args', () => {
    expect(
      extractFuncCallArgColumnNames({
        FuncCall: {
          funcname: [{ String: { sval: 'coalesce' } }],
          args: [{ Integer: { ival: 0 } }],
        },
      }),
    ).toEqual([])
  })

  it('returns an empty array for a node that is not a FuncCall', () => {
    expect(extractFuncCallArgColumnNames({ Integer: { ival: 0 } })).toEqual([])
  })

  it('treats a ColumnRef without fields as having no column names', () => {
    expect(
      extractFuncCallArgColumnNames({
        FuncCall: {
          funcname: [{ String: { sval: 'uuid_extract_timestamp' } }],
          args: [{ ColumnRef: {} }],
        },
      }),
    ).toEqual([])
  })
})
