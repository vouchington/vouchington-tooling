import { describe, expect, it } from 'vitest'

import { createArtifactClassifier, parseArtifactPatternsJson } from './index.mts'

const classifier = createArtifactClassifier({
  keepPatterns: ['plan-*', 'static-*'],
  deletePatterns: ['coverage-*', 'report-*'],
})

describe('createArtifactClassifier', () => {
  it('keeps matching names and deletes everything else', () => {
    expect(classifier.classify('plan-main')).toBe('keep')
    expect(classifier.classify('static-assets')).toBe('keep')
    expect(classifier.classify('coverage-unit')).toBe('delete')
    expect(classifier.classify('unknown-artifact')).toBe('delete')
  })

  it('treats keep as authoritative even when a delete pattern also matches', () => {
    const overlapping = createArtifactClassifier({
      keepPatterns: ['keep-*'],
      deletePatterns: ['keep-*'],
    })
    expect(overlapping.classify('keep-me')).toBe('keep')
    expect(overlapping.isExplicitlyClassified('keep-me')).toBe(true)
  })

  it('treats empty pattern lists as match-nothing', () => {
    const empty = createArtifactClassifier({ keepPatterns: [], deletePatterns: [] })
    expect(empty.classify('anything')).toBe('delete')
    expect(empty.isExplicitlyClassified('anything')).toBe(false)
  })

  it('reports explicit classification for keep and delete patterns only', () => {
    expect(classifier.isExplicitlyClassified('plan-main')).toBe(true)
    expect(classifier.isExplicitlyClassified('coverage-unit')).toBe(true)
    expect(classifier.isExplicitlyClassified('report-shard-12')).toBe(true)
    expect(classifier.isExplicitlyClassified('report')).toBe(false)
    expect(classifier.isExplicitlyClassified('unknown-artifact')).toBe(false)
  })
})

describe('parseArtifactPatternsJson', () => {
  it('reads keep and delete arrays and defaults missing keys to empty', () => {
    expect(parseArtifactPatternsJson({ keep: ['plan-*'], delete: ['coverage-*'] })).toEqual({
      keepPatterns: ['plan-*'],
      deletePatterns: ['coverage-*'],
    })
    expect(parseArtifactPatternsJson({})).toEqual({ keepPatterns: [], deletePatterns: [] })
  })

  it('rejects invalid JSON shapes', () => {
    expect(() => parseArtifactPatternsJson(null)).toThrow(/JSON object/)
    expect(() => parseArtifactPatternsJson([])).toThrow(/JSON object/)
    expect(() => parseArtifactPatternsJson('nope')).toThrow(/JSON object/)
    expect(() => parseArtifactPatternsJson({ keep: 'plan-*' })).toThrow(/keep must be an array/)
    expect(() => parseArtifactPatternsJson({ delete: [1] })).toThrow(/delete must be an array/)
  })
})
