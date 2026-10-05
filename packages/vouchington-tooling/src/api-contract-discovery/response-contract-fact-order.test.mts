import { expect, it } from 'vitest'

import ts from '../contract-schema/typescript-api.mts'
import { buildVirtualProgramMatrix } from './test-setup.test-helpers.mts'
import { isInErrorBranch } from './response-contract-error-branch.mts'
import { sortAttributionFacts } from './response-contract-attribution-facts.mts'

const matrix = buildVirtualProgramMatrix(import.meta, {
  'dead-status': `
    function inspect(ctx: any, status: any) {
      if (false) {
        ctx.setStatus(status)
        ctx.json({ error: 'unreachable' })
      }
    }
  `,
})

it('sorts reverse paths and equal-line columns deterministically', () => {
  const facts = [
    { sourceLocation: '/virtual/z.ts:2:9', label: 'later', routes: [] },
    { sourceLocation: '/virtual/a.ts:1:1', label: 'path', routes: [] },
    { sourceLocation: '/virtual/z.ts:2:3', label: 'earlier', routes: [] },
  ] as const
  expect(sortAttributionFacts(facts).map(({ sourceLocation }) => sourceLocation)).toEqual([
    '/virtual/a.ts:1:1',
    '/virtual/z.ts:2:3',
    '/virtual/z.ts:2:9',
  ])
})

it('continues past a direct status setter that the compiler proves unreachable', () => {
  const sourceFile = matrix.sourceFile('dead-status')
  let emission: ts.CallExpression | undefined
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json'
    )
      emission = node
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  expect(emission).toBeDefined()
  expect(isInErrorBranch(emission!, true, matrix.program.getTypeChecker())).toBe(false)
})
