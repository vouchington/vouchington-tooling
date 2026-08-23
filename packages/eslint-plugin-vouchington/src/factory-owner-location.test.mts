import { describe, expect, it } from 'vitest'

import {
  createFactoryOwnerLocationRule,
  resolveFactoryOwnerOptions,
} from './factory-owner-location.mts'
import { lintRule, messageIds } from './lint-rule.test-helpers.mts'

const OPTIONS = {
  modules: ['typescript'],
  factories: ['createProgram'],
  owners: ['src/owner.js'],
  include: ['**/*.js'],
}

describe('factory-owner-location', () => {
  it('allows factory calls only in owner files', async () => {
    const named = `import { createProgram } from 'typescript'\ncreateProgram()\n`
    expect(messageIds(await lintRule('factory-owner-location', named, OPTIONS))).toEqual([
      'constructionOwner',
    ])
    expect(
      messageIds(await lintRule('factory-owner-location', named, OPTIONS, 'src/owner.js')),
    ).toEqual([])
  })

  it('flags namespace and createRequire factory calls', async () => {
    expect(
      messageIds(
        await lintRule(
          'factory-owner-location',
          `import * as ts from 'typescript'\nts.createProgram()\n`,
          OPTIONS,
        ),
      ),
    ).toEqual(['constructionOwner'])
    expect(
      messageIds(
        await lintRule(
          'factory-owner-location',
          `import * as module from 'node:module'\nmodule.createRequire(import.meta.url)('typescript').createProgram()\n`,
          OPTIONS,
        ),
      ),
    ).toEqual(['constructionOwner'])
    expect(
      messageIds(
        await lintRule(
          'factory-owner-location',
          `import { createRequire } from 'node:module'\nconst require = createRequire(import.meta.url)\nrequire('typescript').createProgram()\n`,
          OPTIONS,
        ),
      ),
    ).toEqual(['constructionOwner'])
  })

  it('ignores other modules and missing options', async () => {
    expect(
      messageIds(
        await lintRule(
          'factory-owner-location',
          `import type { createProgram } from 'typescript'\ncreateProgram()\n`,
          OPTIONS,
        ),
      ),
    ).toEqual([])
    expect(
      messageIds(
        await lintRule(
          'factory-owner-location',
          `const helper = { createProgram() {} }\nhelper.createProgram()\n`,
          OPTIONS,
        ),
      ),
    ).toEqual([])
    expect(
      messageIds(
        await lintRule(
          'factory-owner-location',
          `function other(name) { return { createProgram() {} } }\nother('typescript').createProgram()\n`,
          OPTIONS,
        ),
      ),
    ).toEqual([])
    expect(
      messageIds(
        await lintRule(
          'factory-owner-location',
          `const foo = { bar: (name) => ({ createProgram() {} }) }\nfoo.bar('typescript').createProgram()\n`,
          OPTIONS,
        ),
      ),
    ).toEqual([])
    expect(resolveFactoryOwnerOptions({ modules: ['typescript'] })).toBeNull()
    expect(resolveFactoryOwnerOptions([])).toBeNull()
    expect(
      resolveFactoryOwnerOptions({
        modules: ['typescript'],
        factories: ['createProgram'],
        owners: ['src/owner.js'],
        include: 1,
      }),
    ).toBeNull()
    expect(createFactoryOwnerLocationRule().meta.messages.constructionOwner).toContain('owner')
  })
})
