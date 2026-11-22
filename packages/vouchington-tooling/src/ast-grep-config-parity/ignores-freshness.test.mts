import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  astGrepIgnoreEntries,
  checkAstGrepIgnoresFreshness,
  staleAstGrepIgnores,
} from './ignores-freshness.mts'

describe('astGrepIgnoreEntries', () => {
  it('reads a string, a list of strings, and nothing else', () => {
    expect(astGrepIgnoreEntries({ ignores: 'a.mts' })).toEqual(['a.mts'])
    expect(astGrepIgnoreEntries({ ignores: ['a.mts', 1, 'b/**'] })).toEqual(['a.mts', 'b/**'])
    expect(astGrepIgnoreEntries({ ignores: 3 })).toEqual([])
    expect(astGrepIgnoreEntries({})).toEqual([])
    expect(astGrepIgnoreEntries(null)).toEqual([])
    expect(astGrepIgnoreEntries(['a'])).toEqual([])
    expect(astGrepIgnoreEntries('a')).toEqual([])
  })
})

describe('staleAstGrepIgnores', () => {
  it('matches dotfiles with globs and tolerates repeated entries', () => {
    expect(
      staleAstGrepIgnores(['.github/**/*.yml', '.github/**/*.yml', 'x/**'], ['.github/a/b.yml']),
    ).toEqual(['x/**'])
  })

  it('treats parentheses as literal path characters', () => {
    expect(staleAstGrepIgnores(['web/(auth)/**'], ['web/(auth)/page.tsx'])).toEqual([])
    expect(staleAstGrepIgnores(['web/(auth)/**'], ['web/auth/page.tsx'])).toEqual(['web/(auth)/**'])
  })

  it('lets a single star cross directory separators', () => {
    expect(staleAstGrepIgnores(['src/*.ts'], ['src/sub/a.ts'])).toEqual([])
    expect(staleAstGrepIgnores(['src/*.ts'], ['src/a.ts'])).toEqual([])
    expect(staleAstGrepIgnores(['src/*.ts'], ['lib/a.ts'])).toEqual(['src/*.ts'])
    expect(staleAstGrepIgnores(['src/**.ts'], ['src/sub/a.ts'])).toEqual([])
    expect(staleAstGrepIgnores(['**/x.ts', 'src/**'], ['src/a/b/x.ts'])).toEqual([])
    expect(staleAstGrepIgnores(['src/**/x.ts'], ['src/a/b/x.ts'])).toEqual([])
  })

  it('reports nothing when there are no globs', () => {
    expect(staleAstGrepIgnores(['a.mts'], ['a.mts'])).toEqual([])
  })
})

describe('checkAstGrepIgnoresFreshness', () => {
  it('reports a missing literal and a glob that matches no tracked file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ast-grep-ignores-'))
    try {
      const ruleFile = 'rules/sample.yml'
      await mkdir(dirname(join(dir, ruleFile)), { recursive: true })
      await writeFile(
        join(dir, ruleFile),
        [
          'id: sample',
          'ignores:',
          "  - 'missing/file.mts'",
          "  - 'kept/file.mts'",
          "  - 'src/**/*.test.mts'",
          "  - 'present/**/*.mts'",
          '---',
          'id: second',
          "ignores: 'gone.mts'",
          '',
        ].join('\n'),
      )
      const tracked = [ruleFile, 'rules/skipped.txt', 'kept/file.mts', 'present/a.mts']
      expect(checkAstGrepIgnoresFreshness(dir, tracked, { localRuleDir: 'rules/' })).toEqual([
        { ruleFile, entry: 'missing/file.mts' },
        { ruleFile, entry: 'src/**/*.test.mts' },
        { ruleFile, entry: 'gone.mts' },
      ])
      expect(checkAstGrepIgnoresFreshness(dir, tracked, { localRuleDir: 'other' })).toEqual([])
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })
})
