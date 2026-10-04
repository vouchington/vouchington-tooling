import { describe, expect, it } from 'vitest'
import { lintRule, messageIds } from './lint-rule.test-helpers.mts'
import { resolveBannedMemberOptions } from './banned-member-read.mts'
import { resolveMemberReadExceptions } from './member-read-exception-options.mts'

const OPTIONS = {
  members: ['invalidate'],
  exceptions: [
    {
      file: 'src/service.js',
      member: 'invalidate',
      module: '@store/cache',
      imported: 'CacheClient',
      local: 'CacheClient',
      kind: 'constructor-constant',
      constant: { name: 'CACHE_GROUP', value: 'cache:group' },
    },
  ],
}

describe('member-read binding exceptions', () => {
  it('allows only the configured imported constructor and constant argument', async () => {
    const prelude = `import { CacheClient } from '@store/cache'; const CACHE_GROUP = 'cache:group';`
    expect(
      messageIds(
        await lintRule(
          'banned-member-read',
          `${prelude} CacheClient.invalidate(CACHE_GROUP)`,
          OPTIONS,
        ),
      ),
    ).toEqual([])
    for (const code of [
      `${prelude} CacheClient.invalidate('cache:group')`,
      `${prelude} const reset = CacheClient.invalidate`,
      `${prelude} function f(CacheClient) { CacheClient.invalidate(CACHE_GROUP) }`,
      `import { Other as CacheClient } from '@store/cache'; const CACHE_GROUP = 'cache:group'; CacheClient.invalidate(CACHE_GROUP)`,
      `import { CacheClient } from '@other/cache'; const CACHE_GROUP = 'cache:group'; CacheClient.invalidate(CACHE_GROUP)`,
      `import { CacheClient } from '@store/cache'; const CACHE_GROUP = 'other'; CacheClient.invalidate(CACHE_GROUP)`,
    ]) {
      expect(messageIds(await lintRule('banned-member-read', code, OPTIONS))).toEqual([
        'bannedRead',
      ])
    }
    expect(
      messageIds(
        await lintRule(
          'banned-member-read',
          `${prelude} CacheClient.invalidate(CACHE_GROUP)`,
          OPTIONS,
          'src/other.js',
        ),
      ),
    ).toEqual(['bannedRead'])
  })

  it('validates optional exception data without accepting a partial exception', () => {
    expect(resolveMemberReadExceptions(undefined)).toEqual([])
    expect(resolveBannedMemberOptions({ members: ['invalidate'], exceptions: null })).toBeNull()
    expect(resolveMemberReadExceptions([[]])).toBeNull()
    for (const value of [
      null,
      {},
      [null],
      [{}],
      [{ ...OPTIONS.exceptions[0], constant: null }],
      [{ ...OPTIONS.exceptions[0], kind: 'const-instance-prefix' }],
      [{ ...OPTIONS.exceptions[0], kind: 'other' }],
    ]) {
      expect(resolveMemberReadExceptions(value)).toBeNull()
    }
    expect(resolveMemberReadExceptions(OPTIONS.exceptions)).toEqual(OPTIONS.exceptions)
  })
})

const INSTANCE_OPTIONS = {
  members: ['invalidate'],
  exceptions: [
    {
      file: 'src/service.js',
      member: 'invalidate',
      module: '@store/cache',
      imported: 'CacheClient',
      local: 'CacheClient',
      kind: 'const-instance-prefix',
      prefix: 'validation',
    },
  ],
}

describe('const-instance prefix exceptions', () => {
  it.each([
    { options: `{ prefix: 'validation' }`, allowed: true },
    { options: `{ prefix: 'validation', null: 0 }`, allowed: true },
    { options: `{ prefix: 'other' }`, allowed: false },
    { options: `{ prefix: 'validation', prefix: 'other' }`, allowed: false },
    { options: `{ prefix: 'other', prefix: 'validation' }`, allowed: true },
    { options: `{ prefix: 'validation', ...rest }`, allowed: false },
    { options: `{ ...rest, prefix: 'validation' }`, allowed: true },
    { options: `{ prefix: 'validation', [key]: value }`, allowed: false },
    { options: `{ [key]: value, prefix: 'validation' }`, allowed: true },
    { options: `{ ['prefix']: 'validation' }`, allowed: true },
    { options: `{ prefix: prefix }`, allowed: false },
    { options: `options`, allowed: false },
    { options: ``, allowed: false },
  ])('tracks the effective prefix for $options', async ({ options, allowed }) => {
    const code = `import { CacheClient } from '@store/cache'; const cache = new CacheClient(${options}); cache.invalidate()`
    expect(messageIds(await lintRule('banned-member-read', code, INSTANCE_OPTIONS))).toEqual(
      allowed ? [] : ['bannedRead'],
    )
  })

  it.each([
    `const cache = new CacheClient({ prefix: 'validation' }); cache?.invalidate()`,
    `const cache = new CacheClient({ prefix: 'validation' }); cache.invalidate?.()`,
    `const cache = new CacheClient({ prefix: 'validation' }); cache.invalidate('x')`,
    `let cache = new CacheClient({ prefix: 'validation' }); cache.invalidate()`,
    `const cache = new CacheClient({ prefix: 'validation' }); cache = other; cache.invalidate()`,
    `const cache = new Alias({ prefix: 'validation' }); cache.invalidate()`,
    `const cache = makeCache(); cache.invalidate()`,
    `const cache = { invalidate() {} }; cache.invalidate()`,
    `new CacheClient({ prefix: 'validation' }).invalidate()`,
    `function reset(cache) { cache.invalidate() }`,
    `missing.invalidate()`,
  ])('rejects mutable, optional, aliased and unproven instances: %s', async (body) => {
    const code = `import { CacheClient } from '@store/cache'; import { CacheClient as Alias } from '@store/cache'; ${body}`
    expect(messageIds(await lintRule('banned-member-read', code, INSTANCE_OPTIONS))).toEqual([
      'bannedRead',
    ])
  })

  it('rejects a missing member exception and malformed common fields', async () => {
    const unrelated = {
      ...INSTANCE_OPTIONS,
      exceptions: [{ ...INSTANCE_OPTIONS.exceptions[0], member: 'other' }],
    }
    expect(
      messageIds(
        await lintRule(
          'banned-member-read',
          `import { CacheClient } from '@store/cache'; const cache = new CacheClient({ prefix: 'validation' }); cache.invalidate()`,
          unrelated,
        ),
      ),
    ).toEqual(['bannedRead'])
    expect(
      resolveMemberReadExceptions([{ ...INSTANCE_OPTIONS.exceptions[0], local: 1 }]),
    ).toBeNull()
    expect(
      resolveMemberReadExceptions([
        {
          ...INSTANCE_OPTIONS.exceptions[0],
          kind: 'constructor-constant',
          constant: { name: 1, value: 'x' },
        },
      ]),
    ).toBeNull()
  })
})
