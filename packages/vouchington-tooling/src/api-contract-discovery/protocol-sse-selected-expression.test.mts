import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { selectedSseExpression } from './protocol-sse-selected-expression.mts'

let root: string
let checker: ts.TypeChecker
let streamSymbol: ts.Symbol
const receivers = new Map<string, ts.Expression>()
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'selected-sse-expression-'))
  const file = join(root, 'controls.ts')
  writeFileSync(
    file,
    `
    interface Stream {output?:Stream; [key:string]:unknown}
    declare const stream:Stream
    declare const other:Stream
    declare const unknownValue:unknown
    declare const condition:boolean
    declare function inspect(name:string,receiver:unknown):void
    inspect('direct',stream)
    inspect('wrapped',(stream as Stream)!)
    inspect('member',stream.output)
    inspect('element',stream['output'])
    inspect('conditionalLeft',condition?stream:other)
    inspect('conditionalRight',condition?other:stream)
    inspect('conditionalUnknown',condition?unknownValue:stream)
    inspect('nullishLeft',stream.output??other)
    inspect('nullishRight',other.output??stream)
    inspect('orLeft',stream.output||other)
    inspect('orRight',other.output||stream)
    inspect('andLeft',stream.output&&other)
    inspect('andRight',condition&&stream)
    inspect('nested',(condition?other:stream.output)??other)
    inspect('independent',other)
    inspect('independentMember',other.output)
    inspect('independentElement',other['output'])
    inspect('independentConditional',condition?other:unknownValue)
    inspect('independentNullish',other.output??unknownValue)
    inspect('independentOr',other.output||unknownValue)
    inspect('independentAnd',condition&&other)
    inspect('unknown',unknownValue)
    inspect('string',stream+'')
    export {}
  `,
  )
  const program = ts.createProgram([file], {
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
  })
  expect(ts.getPreEmitDiagnostics(program)).toEqual([])
  checker = program.getTypeChecker()
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'stream')
      streamSymbol = checker.getSymbolAtLocation(node.name)!
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'inspect'
    ) {
      const [name, receiver] = node.arguments
      if (name && ts.isStringLiteral(name) && receiver) receivers.set(name.text, receiver)
    }
    ts.forEachChild(node, visit)
  }
  visit(program.getSourceFile(file)!)
  expect(receivers.size).toBe(23)
  expect(streamSymbol).toBeDefined()
})
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})
function retains(name: string): boolean {
  const receiver = receivers.get(name)
  if (!receiver) throw new Error(`Missing compiler-backed receiver ${name}`)
  return selectedSseExpression(
    receiver,
    (value) => ts.isIdentifier(value) && checker.getSymbolAtLocation(value) === streamSymbol,
  )
}
it.each([
  'direct',
  'wrapped',
  'member',
  'element',
  'conditionalLeft',
  'conditionalRight',
  'conditionalUnknown',
  'nullishLeft',
  'nullishRight',
  'orLeft',
  'orRight',
  'andLeft',
  'andRight',
  'nested',
])('retains the selected stream capability through %s', (name) => expect(retains(name)).toBe(true))
it.each([
  'independent',
  'independentMember',
  'independentElement',
  'independentConditional',
  'independentNullish',
  'independentOr',
  'independentAnd',
  'unknown',
  'string',
])('does not invent a selected capability for %s', (name) => expect(retains(name)).toBe(false))
