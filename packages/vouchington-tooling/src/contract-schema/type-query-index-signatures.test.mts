import { describe, expect, it } from 'vitest'

import { getCallRowTypeFacts } from './type-query-call.mts'
import { getExportedTypeFacts } from './type-query.mts'
import ts from './typescript-api.mts'
import { buildVirtualProgramMatrix } from './virtual-program.mts'

const matrix = buildVirtualProgramMatrix(import.meta, {
  contracts: `export interface IndexedRow { [key: string]: number }
export interface NumberIndexedRow { [index: number]: boolean }
export interface MixedIndexedRow { [key: string]: string | number; [index: number]: number }
export interface NonFiniteIndexedRow { [key: string]: string | number; [index: number]: number }`,
  calls: `declare function readStringIndexedRows(): Promise<{ [key: string]: { id: string }[] }>
declare const mixed: { [key: string]: string | number; [index: number]: number }
readStringIndexedRows(); mixed[NaN]; mixed[Infinity]; mixed[-Infinity]; mixed[-0]; mixed['01']`,
})
const program = matrix.program
const contracts = matrix.sourceFile('contracts').fileName
const calls = matrix.sourceFile('calls')

describe('type-query index signatures', () => {
  it('uses applicable number and string index signatures for requested properties', () => {
    expect(
      getExportedTypeFacts({
        typescript: ts,
        program,
        fileName: contracts,
        exportName: 'IndexedRow',
        propertyNames: ['1', 'id'],
      }).properties,
    ).toEqual({ 1: 'number', id: 'number' })
    expect(
      getExportedTypeFacts({
        typescript: ts,
        program,
        fileName: contracts,
        exportName: 'NumberIndexedRow',
        propertyNames: ['0', 'id'],
      }).properties,
    ).toEqual({ 0: 'boolean', id: undefined })
    expect(
      getExportedTypeFacts({
        typescript: ts,
        program,
        fileName: contracts,
        exportName: 'MixedIndexedRow',
        propertyNames: ['0', 'id'],
      }).properties,
    ).toEqual({ 0: 'number', id: 'string | number' })
  })

  it('selects awaited rows from a string index signature', () => {
    expect(
      getCallRowTypeFacts({
        typescript: ts,
        program,
        fileName: calls.fileName,
        calleeText: 'readStringIndexedRows',
        rowSource: 'awaitedRows',
        propertyNames: ['id'],
      }),
    ).toMatchObject([{ display: '{ id: string; }', properties: { id: 'string' } }])
  })

  it('matches compiler facts for special numeric property names', () => {
    const checker = program.getTypeChecker()
    const accesses: ts.ElementAccessExpression[] = []
    function visit(node: ts.Node): void {
      if (ts.isElementAccessExpression(node) && node.expression.getText(calls) === 'mixed') {
        accesses.push(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(calls)
    expect(
      accesses.map((access) => checker.typeToString(checker.getTypeAtLocation(access))),
    ).toEqual(['number', 'number', 'number', 'number', 'string | number'])
    expect(
      getExportedTypeFacts({
        typescript: ts,
        program,
        fileName: contracts,
        exportName: 'NonFiniteIndexedRow',
        propertyNames: ['NaN', 'Infinity', '-Infinity', '-0', '01'],
      }).properties,
    ).toEqual({
      NaN: 'number',
      Infinity: 'number',
      '-Infinity': 'number',
      '-0': 'string | number',
      '01': 'string | number',
    })
  })
})
