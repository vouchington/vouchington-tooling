import { describe, expect, it } from 'vitest'

import { lintRule, messageIds } from './lint-rule.test-helpers.mts'

const OPTIONS = {
  modules: ['@compiler/runtime'],
  factories: ['makeGraph'],
  owners: ['src/owner.js'],
  include: ['**/*.js'],
}

async function diagnostics(source: string): Promise<string[]> {
  return messageIds(await lintRule('factory-owner-location', source, OPTIONS, 'src/check.js'))
}

describe('factory-owner-location direct syntax', () => {
  it('follows only the last value of awaited import sequences', async () => {
    expect(await diagnostics(`(await (0, import('@compiler/runtime'))).makeGraph()`)).toEqual([
      'constructionOwner',
    ])
    expect(await diagnostics(`(await (import('@compiler/runtime'), 0)).makeGraph()`)).toEqual([])
  })

  it('recognizes calls through factory call and apply members', async () => {
    expect(
      await diagnostics(`import { makeGraph } from '@compiler/runtime'
makeGraph.call(null)
makeGraph.apply(null, [])
const other = { call() {}, apply() {} }
other.call(null)
other.apply(null)`),
    ).toEqual(['constructionOwner', 'constructionOwner'])
  })

  it('preserves factory identity through await and exported default', async () => {
    expect(
      await diagnostics(`import { makeGraph } from '@compiler/runtime'
(await makeGraph)()
const graph = await makeGraph
graph()
export default await makeGraph`),
    ).toEqual(['constructionOwner', 'constructionOwner', 'constructionOwner'])
  })

  it('does not infer factory provenance from object rest copies', async () => {
    expect(
      await diagnostics(`import * as runtime from '@compiler/runtime'
export const { ...rest } = runtime`),
    ).toEqual([])
  })
})
