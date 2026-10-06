import { describe, expect, it } from 'vitest'
import { isNode, parseSource, propertyName, walk, type UnknownNode } from './source-ast.mts'
import {
  isAppendCall,
  isPushCall,
  appendReceiverName,
  isSqlStatementInitializer,
  canonicalCallNames,
  isTerminalSqlCall,
} from './source-helpers.mts'
import { collectEligibleImports } from './source-sql.mts'
import { terminalSqlExecutorBindings } from './source-executors.mts'
import { walkWithAncestors, isSetHasCall, containsNode } from './public-boundary-ast.mts'
import type { ReaderSourceAnalysisOptions } from './source-options.mts'
const options: ReaderSourceAnalysisOptions = {
  canonicalImports: new Map([
    ['buildFilter', new Set(['@fixture/builders'])],
    ['buildAccess', new Set(['./access.mts'])],
    ['buildPublicFilter', new Set(['@fixture/builders'])],
    ['collectVisibleIds', new Set(['@fixture/boundary'])],
    ['loadDescendants', new Set(['@fixture/descendants'])],
    ['loadVisibleDescendants', new Set(['./visible-ids.mts'])],
  ]),
  sql: {
    templateTag: 'sql',
    appendMethod: 'append',
    placeholderPrefix: 'fixture_',
    executorImports: new Map([
      ['@fixture/database', new Set(['read', 'write', 'query', 'readStream', 'explainAnalyze'])],
    ]),
  },
  ignoredCall: 'ignore',
  candidateIdProperty: 'id',
}

describe('relocated private AST boundaries', () => {
  it('uses real parser nodes for unsupported receiver and import shapes', () => {
    const ast =
      parseSource(`import db,{read as execute} from '@fixture/database';import {other} from '@fixture/database';
 const run=flag?execute:opaque;const unrelated=flag?other:opaque;
 function fn(){return;} const object={['quoted']:1,[value]:2};
 sql\`SELECT 1\`; receiver.append();receiver.push();receiver.has();(make()).append();
 // ordinary comment
 `).ast
    const nodes: UnknownNode[] = []
    walk(ast, (node) => nodes.push(node))
    expect(ast.tokens).toBeUndefined()
    expect(isNode(null)).toBe(false)
    expect(propertyName(undefined)).toBeNull()
    expect(propertyName(ast)).toBeNull()
    expect(
      propertyName(nodes.find((node) => node.type === 'Literal' && node.value === 1)),
    ).toBeNull()
    expect(canonicalCallNames(undefined, new Set())).toEqual([])
    expect(terminalSqlExecutorBindings(ast, options)).toEqual(new Set(['execute', 'run']))
    const imported = new Set<string>()
    collectEligibleImports(ast, '@fixture/builders', ['buildFilter'], imported, options)
    expect(imported.size).toBe(0)
    let calls = 0
    for (const node of nodes) {
      isAppendCall(node, options)
      isPushCall(node)
      appendReceiverName(node)
      isSqlStatementInitializer(node, options)
      isTerminalSqlCall(node, new Set(['execute']))
      isSetHasCall(node)
      if (node.type === 'CallExpression') calls++
    }
    expect(calls).toBe(5)
    expect(
      appendReceiverName(
        nodes.find((node) => node.type === 'CallExpression' && appendReceiverName(node) === null)!,
      ),
    ).toBeNull()
    let visited = 0
    walk(undefined, () => {
      visited++
    })
    expect(visited).toBe(0)
    walkWithAncestors(ast, [], (node) => {
      expect(containsNode(ast, node)).toBe(true)
    })
  })
})
