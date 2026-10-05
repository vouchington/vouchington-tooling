import { beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
import {
  createProtocolCallbackValueResolver,
  type CallbackValue,
} from './protocol-callback-values.mts'
import { createContextReceiverGuard } from './protocol-http-context-receiver.mts'
import { createHttpContextValueResolver } from './protocol-http-context-values.mts'

const name = '/virtual/receiver-bindings.ts'
const text = `function callback(){}
function factory({callback}:{callback:()=>void}) {callback.call(null)}
factory({callback});
const options={callback};options.callback();export {};`
let program: ts.Program
let file: ts.SourceFile

function callNamed(name: string): ts.CallExpression {
  let found: ts.CallExpression | undefined
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText() === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!found) throw new Error(`Missing call ${name}`)
  return found
}

describe('HTTP receiver binding boundaries', () => {
  beforeAll(() => {
    const options: ts.CompilerOptions = {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      strict: true,
      skipLibCheck: true,
    }
    const host = ts.createCompilerHost(options, true)
    const readSource = host.getSourceFile.bind(host)
    host.getSourceFile = (path, version, onError, createNew) =>
      path === name
        ? ts.createSourceFile(path, text, version, true)
        : readSource(path, version, onError, createNew)
    program = ts.createProgram([name], options, host)
    const source = program.getSourceFile(name)
    if (!source) throw new Error('Missing receiver binding fixture')
    file = source
    expect(ts.getPreEmitDiagnostics(program)).toEqual([])
  })

  it('declines a declared-function receiver produced by actual destructured bindings', () => {
    const checker = program.getTypeChecker()
    const factory = file.statements.find(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && node.name?.text === 'factory',
    )
    if (!factory) throw new Error('Missing factory')
    const bindings = callbackArgumentBindings(
      factory,
      callNamed('factory'),
      new Map(),
      new Map(),
      checker,
      createProtocolCallbackValueResolver(checker),
    )
    if (!bindings) throw new Error('Missing callback bindings')
    expect([...bindings.values()].some((value) => ts.isFunctionDeclaration(value.node))).toBe(true)
    const resolver = createHttpContextValueResolver(checker, program.getSourceFiles())
    const guard = createContextReceiverGuard(checker, resolver.resolve)
    expect(guard.safe(callNamed('callback.call'), bindings)).toBe(false)
    for (const symbol of bindings.keys()) expect(guard.checking(symbol, bindings)).toBe(false)
    expect(guard.safe(callNamed('options.callback'), new Map())).toBe(true)
  })

  it('rejects cyclic caller bindings and clears the receiver frame afterwards', () => {
    const checker = program.getTypeChecker()
    const call = callNamed('options.callback')
    if (!ts.isPropertyAccessExpression(call.expression)) throw new Error('Missing receiver')
    const owner = call.expression.expression
    const symbol = checker.getSymbolAtLocation(owner)
    if (!symbol) throw new Error('Missing receiver symbol')
    const bindings = new Map<ts.Symbol, CallbackValue>()
    bindings.set(symbol, { node: owner, env: bindings })
    const resolver = createHttpContextValueResolver(checker, program.getSourceFiles())
    const guard = createContextReceiverGuard(checker, resolver.resolve)
    expect(guard.safe(call, bindings)).toBe(false)
    expect(guard.checking(symbol, bindings)).toBe(false)
    expect(guard.safe(call, new Map())).toBe(true)
  })
})
