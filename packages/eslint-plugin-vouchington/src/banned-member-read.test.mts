import { describe, expect, it } from 'vitest'

import { createBannedMemberReadRule, resolveBannedMemberOptions } from './banned-member-read.mts'
import { lintRule, messageIds } from './lint-rule.test-helpers.mts'

const OPTIONS = {
  members: ['invalidate'],
  include: ['**/*.{js,mts}'],
  exclude: ['src/allowed.js'],
}

describe('banned-member-read', () => {
  it('reports member reads and object-pattern aliases', async () => {
    expect(
      messageIds(await lintRule('banned-member-read', 'cache.invalidate()\n', OPTIONS)),
    ).toEqual(['bannedRead'])
    expect(
      messageIds(await lintRule('banned-member-read', 'const { invalidate } = cache\n', OPTIONS)),
    ).toEqual(['bannedRead'])
    expect(
      messageIds(await lintRule('banned-member-read', 'cache.invalidate = reset\n', OPTIONS)),
    ).toEqual([])
    expect(
      messageIds(await lintRule('banned-member-read', 'delete cache.invalidate\n', OPTIONS)),
    ).toEqual([])
  })

  it('honors exclude globs and missing options', async () => {
    expect(
      messageIds(
        await lintRule('banned-member-read', 'cache.invalidate()\n', OPTIONS, 'src/allowed.js'),
      ),
    ).toEqual([])
    expect(messageIds(await lintRule('banned-member-read', 'cache.invalidate()\n', null))).toEqual(
      [],
    )
    expect(resolveBannedMemberOptions(null)).toBeNull()
    expect(resolveBannedMemberOptions({ members: [] })).toBeNull()
    expect(createBannedMemberReadRule().meta.messages.bannedRead).toContain('banned member')
    expect(resolveBannedMemberOptions({ members: ['invalidate'], include: 1 })).toBeNull()
    expect(
      messageIds(
        await lintRule('banned-member-read', 'const value = { invalidate: 1 }\n', OPTIONS),
      ),
    ).toEqual([])
    expect(
      messageIds(
        await lintRule(
          'banned-member-read',
          'cache.invalidate()\n',
          { ...OPTIONS, includeFiles: ['src/extra.js'] },
          'src/extra.js',
        ),
      ),
    ).toEqual(['bannedRead'])
  })
})
