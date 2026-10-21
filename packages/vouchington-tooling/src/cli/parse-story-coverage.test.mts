import { describe, expect, it } from 'vitest'
import { parseCli } from './parse.mts'
import { parseStoryCoverage } from './parse-story-coverage.mts'

const REQUIRED = [
  '--root',
  'repo',
  '--component-root',
  'ui/components',
  '--story-root',
  'ui/stories',
  '--source-extension',
  '.ts',
  '--source-extension',
  '.tsx',
  '--component-extension',
  '.tsx',
  '--marker',
  'data-marker',
  '--story-pattern',
  '\\.stories\\.tsx$',
  '--alias',
  '@/=ui/',
  '--exclusions',
  'exclusions.json',
  '--exclusions-label',
  'exclusions.json',
]

describe('parseStoryCoverage', () => {
  it('parses a complete command', () => {
    expect(parseStoryCoverage(REQUIRED)).toEqual({
      kind: 'story-coverage',
      root: 'repo',
      componentRoot: 'ui/components',
      storyRoot: 'ui/stories',
      aliases: { '@/': 'ui/' },
      sourceExtensions: ['.ts', '.tsx'],
      componentExtensions: ['.tsx'],
      marker: 'data-marker',
      storyPattern: '\\.stories\\.tsx$',
      exclusionsFile: 'exclusions.json',
      exclusionsLabel: 'exclusions.json',
    })
    expect(parseCli(['node', 'vouchington', 'story-coverage', ...REQUIRED])).toMatchObject({
      kind: 'story-coverage',
      root: 'repo',
    })
  })

  it('reports help, unknown options, and missing values', () => {
    expect(parseStoryCoverage(['--help'])).toEqual({ kind: 'help' })
    expect(parseStoryCoverage(['-h'])).toEqual({ kind: 'help' })
    expect(parseStoryCoverage([])).toEqual({
      kind: 'error',
      message: 'story-coverage requires --root',
    })
    expect(parseStoryCoverage(['--nope'])).toEqual({
      kind: 'error',
      message: 'unknown story-coverage option: --nope',
    })
    expect(parseStoryCoverage(['root'])).toEqual({
      kind: 'error',
      message: 'unknown story-coverage option: root',
    })
    const sparse: string[] = []
    sparse.length = 1
    expect(parseStoryCoverage(sparse)).toEqual({
      kind: 'error',
      message: 'unknown story-coverage option: ',
    })
    expect(parseStoryCoverage(['--root'])).toEqual({
      kind: 'error',
      message: '--root requires a value',
    })
    expect(parseStoryCoverage(['--root', '--component-root'])).toEqual({
      kind: 'error',
      message: '--root requires a value',
    })
    expect(parseStoryCoverage(['--alias', ''])).toEqual({
      kind: 'error',
      message: '--alias requires a value',
    })
    expect(parseStoryCoverage(['--alias', '=ui/'])).toEqual({
      kind: 'error',
      message: '--alias must be <prefix>=<path>',
    })
    expect(parseStoryCoverage(['--alias', '@/='])).toEqual({
      kind: 'error',
      message: '--alias must be <prefix>=<path>',
    })
  })

  it('names the first missing required flag', () => {
    expect(failure(['--component-root', 'ui/components'])).toBe('story-coverage requires --root')
    expect(failure(['--root', 'repo'])).toBe('story-coverage requires --component-root')
    expect(failure(['--root', 'repo', '--component-root', 'ui'])).toBe(
      'story-coverage requires --story-root',
    )
    expect(failure(['--root', 'repo', '--component-root', 'ui', '--story-root', 'stories'])).toBe(
      'story-coverage requires --source-extension',
    )
    expect(
      failure([
        '--root',
        'repo',
        '--component-root',
        'ui',
        '--story-root',
        'stories',
        '--source-extension',
        '.ts',
      ]),
    ).toBe('story-coverage requires --component-extension')
    expect(
      failure([
        '--root',
        'repo',
        '--component-root',
        'ui',
        '--story-root',
        'stories',
        '--source-extension',
        '.ts',
        '--component-extension',
        '.tsx',
      ]),
    ).toBe('story-coverage requires --marker')
    expect(
      failure([
        '--root',
        'repo',
        '--component-root',
        'ui',
        '--story-root',
        'stories',
        '--source-extension',
        '.ts',
        '--component-extension',
        '.tsx',
        '--marker',
        'marker',
      ]),
    ).toBe('story-coverage requires --story-pattern')
  })
})

function failure(args: readonly string[]): string {
  const parsed = parseStoryCoverage(args)
  if (parsed.kind !== 'error') throw new Error(`expected an error, got ${parsed.kind}`)
  return parsed.message
}
