import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getCallRowTypeFacts } from './type-query-call.mts'
import { getExportedTypeFacts } from './type-query.mts'
import ts from './typescript-api.mts'
import { buildVirtualProgramMatrix } from './virtual-program.mts'

const matrix = buildVirtualProgramMatrix(import.meta, {
  contracts: `export interface Entity { id: string; title: string }
type Projected = { id: string }
export { Projected as RowAlias }
export type AnyRow = any
export interface ProtoRow { '__proto__': string }
export interface Executor { <T = Projected>(): Promise<{ rows: T[] }> }
export type Box<T = Projected> = { value: T }
export type DependentBox<T = Projected, U = T> = { value: U }
namespace Types { export interface External { id: string } }
export type QualifiedBox<U = Types.External> = { value: U }
export declare function read<T = Projected>(): Promise<{ rows: T[] }>
export declare function write<T = Projected>(): Promise<{ rows: T[] }>
export declare function scalar(): Promise<number>
export declare function noDefault<T>(): T`,
  calls: `interface Entity { id: string; title: string }
declare function read<T>(): Promise<{ rows: T[] }>
declare function write<T>(): Promise<{ rows: T[] }>
declare function scalar(): Promise<number>
declare function pair<Key, Row>(): Promise<{ rows: Row[] }>
declare function readAny(): any
declare function readAnyRows(): Promise<{ rows: any }>
read<{ id: string }>()
write<{ id: string; title: string }>()
read<{ id: string }>()
scalar()
pair<number, { id: string }>()
readAny()
readAnyRows()`,
})
const program = matrix.program
const contracts = matrix.sourceFile('contracts').fileName
const calls = matrix.sourceFile('calls').fileName
const entity = { fileName: contracts, exportName: 'Entity' }
const rowAlias = { fileName: contracts, exportName: 'RowAlias' }

describe('type-query exported facts', () => {
  it('resolves exported aliases with requested properties and assignability', () => {
    expect(
      getExportedTypeFacts({
        program,
        ...rowAlias,
        propertyNames: ['title', 'id', 'id'],
        assignableTo: { entity, row: rowAlias },
      }),
    ).toEqual({
      display: 'Projected',
      isAny: false,
      properties: { id: 'string', title: undefined },
      assignableTo: { entity: false, row: true },
    })
    expect(getExportedTypeFacts({ program, fileName: contracts, exportName: 'AnyRow' }).isAny).toBe(
      true,
    )
    expect(
      getExportedTypeFacts({ program, fileName: contracts, exportName: 'read' }).display,
    ).toContain('Promise<{ rows: T[]; }>')
    const protoFacts = getExportedTypeFacts({
      program,
      fileName: contracts,
      exportName: 'ProtoRow',
      propertyNames: ['__proto__'],
      assignableTo: Object.fromEntries([['__proto__', rowAlias]]),
    })
    expect(Object.hasOwn(protoFacts.properties, '__proto__')).toBe(true)
    expect(protoFacts.properties.__proto__).toBe('string')
    expect(Object.hasOwn(protoFacts.assignableTo, '__proto__')).toBe(true)
    expect(protoFacts.assignableTo.__proto__).toBe(false)
  })

  it('reads default type parameters from callable exports and call signatures', () => {
    for (const exportName of ['Executor', 'Box', 'read']) {
      expect(
        getExportedTypeFacts({
          program,
          fileName: contracts,
          exportName,
          defaultTypeParameterIndex: 0,
          propertyNames: ['id'],
          assignableTo: { entity },
        }),
      ).toMatchObject({
        isAny: false,
        properties: { id: 'string' },
        assignableTo: { entity: false },
      })
    }
    expect(
      getExportedTypeFacts({
        program,
        fileName: contracts,
        exportName: 'DependentBox',
        defaultTypeParameterIndex: 1,
        propertyNames: ['id'],
        assignableTo: { entity },
      }),
    ).toMatchObject({
      isAny: false,
      properties: { id: 'string' },
      assignableTo: { entity: false },
    })
    expect(
      getExportedTypeFacts({
        program,
        fileName: contracts,
        exportName: 'QualifiedBox',
        defaultTypeParameterIndex: 0,
        propertyNames: ['id'],
      }),
    ).toMatchObject({ isAny: false, properties: { id: 'string' } })
  })

  it('follows a reexport to its declared type in a second real source file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'type-query-alias-'))
    try {
      const declared = join(directory, 'declared.ts')
      const reexported = join(directory, 'reexported.ts')
      writeFileSync(declared, 'export interface RecordValue { id: string; label: string }')
      writeFileSync(reexported, "export { RecordValue as PublicValue } from './declared'")
      const linkedProgram = ts.createProgram([declared, reexported], {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        target: ts.ScriptTarget.ESNext,
      })
      expect(linkedProgram.getSemanticDiagnostics()).toEqual([])
      expect(
        getExportedTypeFacts({
          program: linkedProgram,
          fileName: reexported,
          exportName: 'PublicValue',
          propertyNames: ['label'],
        }),
      ).toMatchObject({ display: 'RecordValue', properties: { label: 'string' } })
      writeFileSync(reexported, "export { MissingThing as Broken } from './absent'")
      const brokenProgram = ts.createProgram([reexported], {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        target: ts.ScriptTarget.ESNext,
      })
      expect(() =>
        getExportedTypeFacts({
          program: brokenProgram,
          fileName: reexported,
          exportName: 'Broken',
        }),
      ).toThrow(/could not be resolved to a declaration/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reports missing source, export, and selected generic default precisely', () => {
    expect(() =>
      getExportedTypeFacts({ program, fileName: '/virtual/missing.ts', exportName: 'Entity' }),
    ).toThrow(/source file .* is not in the program/)
    expect(() =>
      getExportedTypeFacts({ program, fileName: contracts, exportName: 'Missing' }),
    ).toThrow(/Missing export "Missing"/)
    expect(() =>
      getExportedTypeFacts({
        program,
        fileName: contracts,
        exportName: 'noDefault',
        defaultTypeParameterIndex: 0,
      }),
    ).toThrow(/Missing default for type parameter 0/)
  })
})

describe('type-query call rows', () => {
  it('returns source-ordered explicit type argument facts and selector filtering', () => {
    const request = {
      program,
      fileName: calls,
      calleeText: 'read',
      rowSource: 'typeArgument' as const,
      propertyNames: ['id', 'title'],
      assignableTo: { entity },
    }
    expect(getCallRowTypeFacts(request)).toEqual([
      {
        line: 8,
        column: 1,
        display: '{ id: string; }',
        isAny: false,
        properties: { id: 'string', title: undefined },
        assignableTo: { entity: false },
      },
      {
        line: 10,
        column: 1,
        display: '{ id: string; }',
        isAny: false,
        properties: { id: 'string', title: undefined },
        assignableTo: { entity: false },
      },
    ])
    expect(getCallRowTypeFacts({ ...request, typeArgumentText: '{ missing: string }' })).toEqual([])
    expect(getCallRowTypeFacts({ ...request, typeArgumentText: '{ id: string }' })).toHaveLength(2)
    expect(getCallRowTypeFacts({ ...request, calleeText: 'absent' })).toEqual([])
  })

  it('extracts awaited rows[number] and direct type arguments from selected calls', () => {
    const request = {
      program,
      fileName: calls,
      calleeText: 'write',
      propertyNames: ['id', 'title'],
      assignableTo: { entity },
    }
    const awaited = getCallRowTypeFacts({ ...request, rowSource: 'awaitedRows' })
    const explicit = getCallRowTypeFacts({ ...request, rowSource: 'typeArgument' })
    expect(awaited).toEqual(explicit)
    expect(awaited).toMatchObject([
      {
        line: 9,
        properties: { id: 'string', title: 'string' },
        assignableTo: { entity: true },
      },
    ])
  })

  it('propagates any from awaited results and their rows property', () => {
    for (const calleeText of ['readAny', 'readAnyRows']) {
      expect(
        getCallRowTypeFacts({
          program,
          fileName: calls,
          calleeText,
          rowSource: 'awaitedRows',
          propertyNames: ['id'],
          assignableTo: { entity },
        }),
      ).toMatchObject([{ isAny: true, properties: { id: undefined } }])
    }
  })

  it('reports missing selected row type arguments and awaited rows', () => {
    expect(() =>
      getCallRowTypeFacts({
        program,
        fileName: calls,
        calleeText: 'scalar',
        rowSource: 'typeArgument',
      }),
    ).toThrow(/Missing row type argument for call "scalar"/)
    expect(() =>
      getCallRowTypeFacts({
        program,
        fileName: calls,
        calleeText: 'scalar',
        rowSource: 'awaitedRows',
      }),
    ).toThrow(/Missing awaited rows element for call "scalar"/)
  })

  it('uses a configured non-first type argument as the row', () => {
    expect(
      getCallRowTypeFacts({
        program,
        fileName: calls,
        calleeText: 'pair',
        rowSource: 'typeArgument',
        typeArgumentIndex: 1,
        propertyNames: ['id'],
      }),
    ).toMatchObject([{ line: 12, properties: { id: 'string' } }])
    expect(() =>
      getCallRowTypeFacts({
        program,
        fileName: calls,
        calleeText: 'pair',
        rowSource: 'typeArgument',
        typeArgumentIndex: 2,
      }),
    ).toThrow(/Missing row type argument for call "pair"/)
  })
})
