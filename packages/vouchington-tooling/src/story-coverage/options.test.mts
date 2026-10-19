import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { patternMatches, storyCoverageConfig, type StoryCoverageRequest } from './options.mts'

function request(extra: Partial<StoryCoverageRequest> = {}): StoryCoverageRequest {
  return {
    root: 'repo',
    componentRoot: 'ui/components',
    storyRoot: 'ui/stories',
    sourceExtensions: ['.ts'],
    componentExtensions: ['.tsx'],
    marker: /marker/,
    storyFilePattern: /\.stories\.tsx$/,
    ...extra,
  }
}

describe('storyCoverageConfig', () => {
  it('normalizes directories and fills defaults', () => {
    const config = storyCoverageConfig(request({ componentRoot: '.\\ui\\components' }))
    expect(config.root).toBe(resolve('repo'))
    expect(config.componentRoot).toBe('ui/components/')
    expect(config.storyRoot).toBe('ui/stories/')
    expect(config.aliases).toEqual({})
    expect(config.exclusions).toEqual({})
    expect(config.exclusionsLabel).toBe('the exclusions map')
  })

  it('keeps caller aliases, exclusions, and label', () => {
    const config = storyCoverageConfig(
      request({
        aliases: { '@/': 'ui/' },
        exclusions: { 'ui/components/a.tsx#A': 'later' },
        exclusionsLabel: 'exclusions.json',
        componentRoot: 'ui/components/',
      }),
    )
    expect(config.aliases).toEqual({ '@/': 'ui/' })
    expect(config.exclusionsLabel).toBe('exclusions.json')
    expect(config.componentRoot).toBe('ui/components/')
  })

  it('rejects overlapping, absolute, empty, and parent directories', () => {
    expect(() => storyCoverageConfig(request({ storyRoot: 'ui/components' }))).toThrow(
      'must not overlap',
    )
    expect(() => storyCoverageConfig(request({ componentRoot: '/abs' }))).toThrow(
      'componentRoot must be a relative directory',
    )
    expect(() => storyCoverageConfig(request({ storyRoot: '../stories' }))).toThrow(
      'storyRoot must be a relative directory',
    )
    expect(() => storyCoverageConfig(request({ componentRoot: '' }))).toThrow(/componentRoot/)
    expect(() => storyCoverageConfig(request({ storyRoot: '.' }))).toThrow(/storyRoot/)
  })

  it('rejects empty extensions, undotted extensions, and non-object exclusions', () => {
    expect(() => storyCoverageConfig(request({ sourceExtensions: [] }))).toThrow(
      'sourceExtensions must not be empty',
    )
    expect(() => storyCoverageConfig(request({ componentExtensions: ['tsx'] }))).toThrow(
      "componentExtensions entries must start with '.'",
    )
    expect(() =>
      storyCoverageConfig(request({ exclusions: [] as unknown as Record<string, unknown> })),
    ).toThrow('exclusions must be a plain object')
    expect(() =>
      storyCoverageConfig(request({ exclusions: null as unknown as Record<string, unknown> })),
    ).toThrow('exclusions must be a plain object')
    expect(() =>
      storyCoverageConfig(request({ exclusions: 'nope' as unknown as Record<string, unknown> })),
    ).toThrow('exclusions must be a plain object')
  })
})

describe('patternMatches', () => {
  it('matches a global pattern more than once', () => {
    const pattern = /marker/g
    expect(patternMatches(pattern, 'marker')).toBe(true)
    expect(patternMatches(pattern, 'marker')).toBe(true)
    expect(patternMatches(pattern, 'other')).toBe(false)
  })
})
