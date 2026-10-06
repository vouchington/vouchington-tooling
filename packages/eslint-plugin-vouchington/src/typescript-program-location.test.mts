import { describe, expect, it } from 'vitest'
import type { RuleContextLike } from './ast-helpers.mts'
import { lintRule, messageIds } from './lint-rule.test-helpers.mts'
import { createTypescriptProgramLocationRule } from './typescript-program-location.mts'

const OPTIONS = {
  modules: ['@compiler/runtime'],
  factories: ['makeGraph'],
  owners: ['src/owner.js'],
  include: ['src/**/*.js'],
}

function visitors(raw: unknown, filename = '/repo/src/check.js') {
  const context = {
    cwd: '/repo',
    filename,
    options: [raw],
    report() {},
    sourceCode: { text: "import { makeGraph } from '@compiler/runtime'", getScope() {} },
  } as unknown as RuleContextLike
  return createTypescriptProgramLocationRule().create(context)
}

describe('typescript-program-location options', () => {
  it('ignores incomplete selections and accepts a configured protected file', () => {
    expect(visitors(null)).toEqual({})
    expect(visitors([])).toEqual({})
    expect(visitors({ modules: [], factories: ['makeGraph'], owners: ['src/owner.js'] })).toEqual(
      {},
    )
    expect(visitors({ ...OPTIONS, include: ['elsewhere/**/*.js'] })).toEqual({})
    expect(visitors(OPTIONS, '/repo/src/owner.js')).toEqual({})
  })

  it('requires explicit virtual matrix lifecycle data', () => {
    expect(visitors({ ...OPTIONS, virtualMatrix: null })).toEqual({})
    expect(visitors({ ...OPTIONS, virtualMatrix: [] })).toEqual({})
    expect(visitors({ ...OPTIONS, virtualMatrix: { moduleBasename: 'matrix-kit' } })).toEqual({})
  })

  it('uses supplied module, factory, and owner names', async () => {
    const code = "import { makeGraph } from '@compiler/runtime'\nmakeGraph()\n"
    expect(messageIds(await lintRule('typescript-program-location', code, OPTIONS))).toEqual([
      'constructionOwner',
    ])
    expect(
      messageIds(await lintRule('typescript-program-location', code, OPTIONS, 'src/owner.js')),
    ).toEqual([])
    expect(
      messageIds(
        await lintRule(
          'typescript-program-location',
          "import { makeGraph } from '@another/runtime'\nmakeGraph()\n",
          OPTIONS,
        ),
      ),
    ).toEqual([])
  })

  it('uses supplied virtual builder and lifecycle hook names', async () => {
    const options = {
      ...OPTIONS,
      virtualMatrix: {
        moduleBasename: 'matrix-kit',
        builder: 'makeMatrix',
        testModule: '@test-kit',
        testHook: 'prepare',
        allowLifecycleFiles: ['src/exempt.js'],
      },
    }
    const code = `import { prepare } from '@test-kit'
import { makeMatrix } from './matrix-kit.mts'
prepare(() => makeMatrix(import.meta, input))
makeMatrix(import.meta, input)`
    expect(messageIds(await lintRule('typescript-program-location', code, options))).toEqual([
      'constructionOwner',
    ])
    expect(
      messageIds(await lintRule('typescript-program-location', code, options, 'src/exempt.js')),
    ).toEqual([])
  })
})
