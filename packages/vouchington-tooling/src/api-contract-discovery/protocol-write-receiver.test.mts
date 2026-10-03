import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { sameWriteReceiver, writeReceiver } from './protocol-write-receiver.mts'

function fixture(includeUnbound = false) {
  const root = mkdtempSync(join(tmpdir(), 'protocol-write-receiver-'))
  const shared = join(root, 'shared.ts')
  const source = join(root, 'routes.ts')
  writeFileSync(
    shared,
    `export declare const source: {stream: {write(value: string): void}; other: {write(value: string): void}} & Record<string, {write(value: string): void}>`,
  )
  writeFileSync(
    source,
    `import {source as sse, source as sender} from './shared'
    declare const other: typeof sse
    declare const dynamic:any
    declare const key: string
    declare const stream: {write(value: string): void}
    sse!.stream.write('nonnull')
    sse.stream.write('same')
    sender.stream.write('import alias')
    other.stream.write('different root')
    sse.other.write('different path')
    stream.write('identifier receiver')
    sse[key].write('computed receiver')
    sse.stream['write']('computed method')
    dynamic[key].stream.write('computed nested')
    ${includeUnbound ? "missing.stream.write('unbound')" : ''}`,
  )
  const program = ts.createProgram([shared, source], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  })
  const sourceFile = program.getSourceFile(source)
  if (!sourceFile) throw new Error('Compiler fixture source was not loaded')
  const calls = new Map<string, ts.CallExpression>()
  const checker = program.getTypeChecker()
  function visit(node: ts.Node) {
    if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.arguments[0] &&
      ts.isStringLiteral(node.expression.arguments[0])
    )
      calls.set(node.expression.arguments[0].text, node.expression)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  return {
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    calls,
    checker,
    diagnostics,
  }
}

describe('protocol write receiver analysis', () => {
  it('resolves non-null property chains and imported aliases to the same symbol path', () => {
    const test = fixture()
    try {
      expect(test.diagnostics).toEqual([])
      const first = writeReceiver(test.calls.get('nonnull')!, test.checker)
      const same = writeReceiver(test.calls.get('same')!, test.checker)
      const importedAlias = writeReceiver(test.calls.get('import alias')!, test.checker)
      expect(first?.path).toEqual(['stream'])
      expect(first?.root).toBeDefined()
      expect(sameWriteReceiver(first!, same)).toBe(true)
      expect(sameWriteReceiver(first!, importedAlias)).toBe(true)
    } finally {
      test.cleanup()
    }
  })

  it('distinguishes roots and property paths', () => {
    const test = fixture()
    try {
      const receiver = writeReceiver(test.calls.get('same')!, test.checker)!
      expect(
        sameWriteReceiver(receiver, writeReceiver(test.calls.get('different root')!, test.checker)),
      ).toBe(false)
      expect(
        sameWriteReceiver(receiver, writeReceiver(test.calls.get('different path')!, test.checker)),
      ).toBe(false)
      expect(sameWriteReceiver(receiver, undefined)).toBe(false)
    } finally {
      test.cleanup()
    }
  })

  it('supports identifier receivers and rejects computed receiver or method access', () => {
    const test = fixture()
    try {
      expect(writeReceiver(test.calls.get('identifier receiver')!, test.checker)?.path).toEqual([])
      expect(writeReceiver(test.calls.get('computed receiver')!, test.checker)).toBeUndefined()
      expect(writeReceiver(test.calls.get('computed method')!, test.checker)).toBeUndefined()
      expect(writeReceiver(test.calls.get('computed nested')!, test.checker)).toBeUndefined()
    } finally {
      test.cleanup()
    }
  })
  it('rejects an unresolved root binding instead of associating its property', () => {
    const test = fixture(true)
    try {
      expect(test.diagnostics).toContain("Cannot find name 'missing'.")
      expect(writeReceiver(test.calls.get('unbound')!, test.checker)).toBeUndefined()
    } finally {
      test.cleanup()
    }
  })
})
