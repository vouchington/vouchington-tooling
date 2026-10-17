import { describe, expect, it } from 'vitest'

import { asArray } from './as-array.mts'
import { isPackageRunner, splitCommandSegments } from './command-segments.mts'

describe('splitCommandSegments', () => {
  it('splits unquoted compound-command operators into separate segments', () => {
    expect(splitCommandSegments('git status && git push')).toEqual([
      ['git', 'status'],
      ['git', 'push'],
    ])
    expect(splitCommandSegments('git push;gh pr view|cat')).toEqual([
      ['git', 'push'],
      ['gh', 'pr', 'view'],
      ['cat'],
    ])
  })

  it('splits on LF and CRLF but keeps quoted newlines', () => {
    expect(splitCommandSegments('echo a\r\necho b')).toEqual([
      ['echo', 'a'],
      ['echo', 'b'],
    ])
    expect(splitCommandSegments('echo "a\nb"')).toEqual([['echo', 'a\nb']])
  })

  it('groups quoted spans, including whitespace and single quotes', () => {
    expect(splitCommandSegments(`git commit -m "fix: git push" 'x y'`)).toEqual([
      ['git', 'commit', '-m', 'fix: git push', 'x y'],
    ])
    expect(splitCommandSegments(`echo "it's"`)).toEqual([['echo', "it's"]])
  })

  it('returns no segments for an empty command', () => {
    expect(splitCommandSegments('')).toEqual([])
  })
})

describe('isPackageRunner', () => {
  it('matches bare and path-qualified runners', () => {
    for (const word of ['npx', 'pnpm', 'pnpx', 'yarn', '/usr/bin/pnpm'])
      expect(isPackageRunner(word)).toBe(true)
  })

  it('rejects other words and undefined', () => {
    expect(isPackageRunner('npm')).toBe(false)
    expect(isPackageRunner('mypnpm')).toBe(false)
    expect(isPackageRunner('')).toBe(false)
    expect(isPackageRunner(undefined)).toBe(false)
  })
})

describe('asArray', () => {
  it('returns arrays unchanged and everything else as an empty array', () => {
    const value = [1]
    expect(asArray(value)).toBe(value)
    expect(asArray(undefined)).toEqual([])
    expect(asArray({ length: 1 })).toEqual([])
  })
})
