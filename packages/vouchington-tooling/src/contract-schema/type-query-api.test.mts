import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getCallRowTypeFacts } from './type-query-call.mts'
import { getExportedTypeFacts, type TypeScriptApi, type TypeScriptProgram } from './type-query.mts'
import ts from './typescript-api.mts'
import ts5 from 'typescript5'

describe('type-query compiler API pairing', () => {
  it('uses the caller compiler API with real TypeScript 5 and 6 programs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'type-query-compiler-pairs-'))
    try {
      const fileName = join(directory, 'pair.ts')
      writeFileSync(
        fileName,
        `export interface PairRow { id: string }
export { PairRow as PairPublic }
export type PairBox<T = PairRow> = { value: T }
declare function read<T>(): Promise<{ rows: T[] }>
declare function rows(): Promise<{ rows: PairRow[] }>
declare function anyRows(): any
declare function neverRows(): Promise<never>
read<PairRow>(); rows(); anyRows(); neverRows()`,
      )
      const checkPair = (typescript: TypeScriptApi, pairedProgram: TypeScriptProgram) => {
        expect(
          getExportedTypeFacts({
            typescript,
            program: pairedProgram,
            fileName,
            exportName: 'PairPublic',
            propertyNames: ['id'],
          }),
        ).toMatchObject({ properties: { id: 'string' } })
        expect(
          getExportedTypeFacts({
            typescript,
            program: pairedProgram,
            fileName,
            exportName: 'PairBox',
            defaultTypeParameterIndex: 0,
            propertyNames: ['id'],
          }).properties,
        ).toEqual({ id: 'string' })
        expect(
          getCallRowTypeFacts({
            typescript,
            program: pairedProgram,
            fileName,
            calleeText: 'read',
            rowSource: 'typeArgument',
            typeArgumentText: 'PairRow',
          }),
        ).toMatchObject([{ display: 'PairRow', isAny: false }])
        for (const [calleeText, display, isAny] of [
          ['rows', 'PairRow', false],
          ['anyRows', 'any', true],
          ['neverRows', 'never', false],
        ] as const) {
          expect(
            getCallRowTypeFacts({
              typescript,
              program: pairedProgram,
              fileName,
              calleeText,
              rowSource: 'awaitedRows',
            }),
          ).toMatchObject([{ display, isAny }])
        }
      }
      checkPair(
        ts5,
        ts5.createProgram([fileName], {
          skipLibCheck: true,
          strict: true,
          target: ts5.ScriptTarget.ESNext,
        }),
      )
      checkPair(
        ts,
        ts.createProgram([fileName], {
          skipLibCheck: true,
          strict: true,
          target: ts.ScriptTarget.ESNext,
        }),
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('rejects a compiler API that does not recognize the Program source file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'type-query-compiler-mismatch-'))
    try {
      const fileName = join(directory, 'mismatch.ts')
      writeFileSync(fileName, 'export interface Mismatch { id: string }')
      const program = ts.createProgram([fileName], { skipLibCheck: true })
      const incompatibleTypescript: TypeScriptApi = {
        ...ts,
        isSourceFile: (_node: ts.Node): _node is ts.SourceFile => false,
      }
      expect(() =>
        getExportedTypeFacts({
          typescript: incompatibleTypescript,
          program,
          fileName,
          exportName: 'Mismatch',
        }),
      ).toThrow(/pass the same compiler API instance/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
