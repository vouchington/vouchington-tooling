import { describe, expect, it } from 'vitest'

import {
  expandBraceAlternatives,
  flattenBraceGlobs,
  isManifestPath,
  manifestGlob,
} from './globs.mts'

describe('workspace registry globs', () => {
  it('builds manifest globs and recognizes manifest paths', () => {
    expect(manifestGlob('packages/*/')).toBe('packages/*/package.json')
    expect(isManifestPath('package.json')).toBe(true)
    expect(isManifestPath('a/package.json')).toBe(true)
    expect(isManifestPath('a/package.jsonc')).toBe(false)
  })

  it('flattens whole-glob brace sets only', () => {
    expect([...flattenBraceGlobs(['{a,b}', 'c/{d,e}'])]).toEqual(['a', 'b', 'c/{d,e}'])
  })

  it('expands nested brace alternatives', () => {
    expect(expandBraceAlternatives('a/{b,c}/{d,e}')).toEqual(['a/b/d', 'a/b/e', 'a/c/d', 'a/c/e'])
    expect(expandBraceAlternatives('plain')).toEqual(['plain'])
  })
})
