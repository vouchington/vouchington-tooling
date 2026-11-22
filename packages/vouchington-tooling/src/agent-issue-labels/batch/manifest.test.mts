import { describe, expect, it } from 'vitest'
import { parseManifest as parse } from './manifest.mts'
import { CANONICAL_PRIORITIES } from './policy.mts'

const OPTIONS = { allowedRepos: ['example/app'] }
const parseManifest = (raw: string, options = OPTIONS) => parse(raw, options)

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    targetRepo: 'example/app',
    entries: [
      {
        id: 'e1',
        title: 'Fix the thing',
        bodyFile: 'body-e1.md',
        paths: ['dev/agent-issue-labels/'],
        priority: 'priority: medium',
      },
    ],
    ...overrides,
  }
}

describe('parseManifest', () => {
  it('parses a minimal valid manifest, defaulting optional fields', () => {
    const manifest = parseManifest(JSON.stringify(validManifest()))
    expect(manifest.targetRepo).toBe('example/app')
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0]).toMatchObject({
      id: 'e1',
      dependencies: [],
      milestone: null,
      extraLabels: [],
    })
    expect(manifest.entries[0]!.duplicateSearch).toEqual({
      query: 'Fix the thing',
      acknowledgedHits: [],
      acknowledgedSiblings: [],
    })
  })

  it('accepts an explicit duplicateSearch with a distinct query and acknowledgments', () => {
    const [baseEntry] = validManifest().entries
    const entry = {
      ...baseEntry,
      duplicateSearch: {
        query: 'keyword search terms',
        acknowledgedHits: [7814, 7763],
        acknowledgedSiblings: ['e2'],
      },
    }
    const manifest = parseManifest(JSON.stringify(validManifest({ entries: [entry] })))
    expect(manifest.entries[0]!.duplicateSearch).toEqual({
      query: 'keyword search terms',
      acknowledgedHits: [7814, 7763],
      acknowledgedSiblings: ['e2'],
    })
  })

  it('accepts a fully populated entry', () => {
    const manifest = parseManifest(
      JSON.stringify(
        validManifest({
          entries: [
            {
              id: 'e1',
              title: 'Fix the thing',
              bodyFile: 'body-e1.md',
              paths: ['dev/'],
              priority: 'priority: high',
              dependencies: ['e2'],
              milestone: 'v1',
              extraLabels: ['backend'],
            },
          ],
        }),
      ),
    )
    expect(manifest.entries[0]).toMatchObject({
      dependencies: ['e2'],
      milestone: 'v1',
      extraLabels: ['backend'],
    })
  })

  it('exposes the canonical priority list', () => {
    expect(CANONICAL_PRIORITIES).toEqual([
      'priority: critical',
      'priority: high',
      'priority: medium',
      'priority: low',
    ])
  })

  it('rejects a targetRepo other than example/app', () => {
    expect(() =>
      parseManifest(JSON.stringify(validManifest({ targetRepo: 'other/repo' })), OPTIONS),
    ).toThrow('manifest.targetRepo must be one of "example/app"')
  })

  it('defaults absent duplicateSearch fields when duplicateSearch is an empty object', () => {
    const [entry] = validManifest().entries
    const manifest = parseManifest(
      JSON.stringify(validManifest({ entries: [{ ...entry, duplicateSearch: {} }] })),
    )
    expect(manifest.entries[0]!.duplicateSearch).toEqual({
      query: 'Fix the thing',
      acknowledgedHits: [],
      acknowledgedSiblings: [],
    })
  })

  it('validates priorities against a caller-supplied policy', () => {
    const [entry] = validManifest().entries
    const policy = { priorityLabels: ['P0', 'P1'], dependenciesLabel: 'blocked-by' }
    const raw = JSON.stringify(validManifest({ entries: [{ ...entry, priority: 'P1' }] }))
    expect(parse(raw, { ...OPTIONS, policy }).entries[0]!.priority).toBe('P1')
    expect(() => parse(JSON.stringify(validManifest()), { ...OPTIONS, policy })).toThrow(
      'priority must be one of P0, P1',
    )
  })

  it('rejects an empty entries array', () => {
    expect(() => parseManifest(JSON.stringify(validManifest({ entries: [] })))).toThrow(
      'manifest.entries must be a non-empty array',
    )
  })

  it('rejects duplicate entry ids', () => {
    const [entry] = validManifest().entries
    expect(() =>
      parseManifest(JSON.stringify(validManifest({ entries: [entry, { ...entry }] }))),
    ).toThrow('Duplicate manifest entry id "e1"')
  })

  it.each([
    ['missing id', { id: undefined }, /\.id must match/],
    ['id with a hyphen (not identifier-safe)', { id: 'e-1' }, /\.id must match/],
    ['id starting with a digit (not identifier-safe)', { id: '1e' }, /\.id must match/],
    ['empty title', { title: '' }, /\.title must be a non-empty string/],
    ['missing bodyFile', { bodyFile: undefined }, /\.bodyFile must be a non-empty string/],
    ['bodyFile with traversal', { bodyFile: '../x.md' }, /cannot contain path traversal/],
    ['absolute bodyFile', { bodyFile: '/x.md' }, /cannot contain path traversal/],
    ['non-array paths', { paths: 'dev/' }, /\.paths must be an array of strings/],
    ['unknown priority', { priority: 'urgent' }, /\.priority must be one of/],
    [
      'non-array dependencies',
      { dependencies: 'e2' },
      /\.dependencies must be an array of strings/,
    ],
    ['non-string milestone', { milestone: 42 }, /\.milestone must be a string or null/],
    [
      'non-array extraLabels',
      { extraLabels: 'backend' },
      /\.extraLabels must be an array of strings/,
    ],
    [
      'non-object duplicateSearch',
      { duplicateSearch: 'keywords' },
      /\.duplicateSearch must be an object/,
    ],
    [
      'empty duplicateSearch.query',
      { duplicateSearch: { query: '' } },
      /\.duplicateSearch\.query must be a non-empty string/,
    ],
    [
      'non-array duplicateSearch.acknowledgedHits',
      { duplicateSearch: { acknowledgedHits: 7814 } },
      /\.duplicateSearch\.acknowledgedHits must be an array of numbers/,
    ],
    [
      'non-number entries in duplicateSearch.acknowledgedHits',
      { duplicateSearch: { acknowledgedHits: ['7814'] } },
      /\.duplicateSearch\.acknowledgedHits must be an array of numbers/,
    ],
    [
      'non-array duplicateSearch.acknowledgedSiblings',
      { duplicateSearch: { acknowledgedSiblings: 'e2' } },
      /\.duplicateSearch\.acknowledgedSiblings must be an array of strings/,
    ],
    [
      'non-string entries in duplicateSearch.acknowledgedSiblings',
      { duplicateSearch: { acknowledgedSiblings: [2] } },
      /\.duplicateSearch\.acknowledgedSiblings must be an array of strings/,
    ],
  ])('rejects %s', (_name, overrides, expectedMessage) => {
    const [baseEntry] = validManifest().entries
    const entry = { ...baseEntry, ...overrides }
    expect(() => parseManifest(JSON.stringify(validManifest({ entries: [entry] })))).toThrow(
      expectedMessage,
    )
  })
})
