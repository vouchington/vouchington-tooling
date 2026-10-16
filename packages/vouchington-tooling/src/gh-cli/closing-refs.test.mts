import { describe, expect, it } from 'vitest'

import {
  formatReferenceKey,
  hasClosingIssueReference,
  parseClosingIssueReferences,
} from './closing-refs.mts'
import { parseNonClosingRefs } from './non-closing-refs.mts'

describe('parseClosingIssueReferences', () => {
  it.each([
    'close',
    'closes',
    'closed',
    'fix',
    'fixes',
    'fixed',
    'resolve',
    'resolves',
    'resolved',
    'CLOSES',
    'Fixes:',
  ])('parses the %s keyword', (keyword) => {
    expect(parseClosingIssueReferences(`${keyword} #12`)).toEqual([
      { key: '#12', number: 12, owner: undefined, repo: undefined },
    ])
  })

  it('parses qualified references and lowercases the repository', () => {
    expect(parseClosingIssueReferences('Closes Owner/Repo#7')).toEqual([
      { key: 'owner/repo#7', number: 7, owner: 'owner', repo: 'repo' },
    ])
  })

  it('parses issue URLs', () => {
    expect(parseClosingIssueReferences('Fixes https://github.com/Acme/Widgets/issues/9')).toEqual([
      { key: 'acme/widgets#9', number: 9, owner: 'acme', repo: 'widgets' },
    ])
  })

  it('deduplicates by key in first-seen order and keeps local and qualified apart', () => {
    const refs = parseClosingIssueReferences('Closes #1\nfixes a/b#1\nResolves #1\nCloses a/b#1')
    expect(refs.map((ref) => ref.key)).toEqual(['#1', 'a/b#1'])
  })

  it.each([
    'Refs #1',
    'closes the loop #1',
    'unclosed #1',
    'Closes #',
    'Closes https://github.com/a/b/pull/3',
  ])('ignores %s', (body) => {
    expect(parseClosingIssueReferences(body)).toEqual([])
  })

  it('skips numbers that are not safe integers', () => {
    expect(parseClosingIssueReferences(`Closes #${'9'.repeat(30)}`)).toEqual([])
  })

  it('skips zero, which is never an issue number', () => {
    expect(parseClosingIssueReferences('Closes #0\nFixes https://github.com/a/b/issues/0')).toEqual(
      [],
    )
    expect(hasClosingIssueReference('Closes #0')).toBe(false)
  })
})

describe('hasClosingIssueReference', () => {
  it('reports whether any closing reference exists', () => {
    expect(hasClosingIssueReference('Closes #1')).toBe(true)
    expect(hasClosingIssueReference('Refs #1')).toBe(false)
  })
})

describe('formatReferenceKey', () => {
  it('formats local and qualified keys', () => {
    expect(formatReferenceKey({ number: 3 })).toBe('#3')
    expect(formatReferenceKey({ number: 3, owner: 'a' })).toBe('#3')
    expect(formatReferenceKey({ number: 3, owner: 'a', repo: 'b' })).toBe('a/b#3')
    expect(formatReferenceKey({ number: 3, owner: 'Acme', repo: 'Widgets' })).toBe('acme/widgets#3')
  })
})

describe('parseNonClosingRefs', () => {
  it('parses Ref, Refs and Part of entries', () => {
    expect(parseNonClosingRefs('Ref #1\nRefs: #2\nPart of #3\nPART  OF #4')).toEqual(
      new Set(['#1', '#2', '#3', '#4']),
    )
  })

  it('lowercases qualified references and deduplicates', () => {
    expect(parseNonClosingRefs('Refs Other/Repo#42\nPart of other/repo#42')).toEqual(
      new Set(['other/repo#42']),
    )
  })

  it('does not treat closing keywords or bare words as references', () => {
    expect(parseNonClosingRefs('Closes #1\nSee the reference implementation')).toEqual(new Set())
  })

  it('does not join reference syntax across NUL-blanked excluded content', () => {
    expect(parseNonClosingRefs('Refs \0\0\0 #12')).toEqual(new Set())
    expect(parseNonClosingRefs('Refs #12 \0\0\0')).toEqual(new Set(['#12']))
  })

  it('skips numbers that are not safe integers', () => {
    expect(parseNonClosingRefs(`Refs #${'9'.repeat(30)}`)).toEqual(new Set())
  })

  it('skips zero, which is never an issue number', () => {
    expect(parseNonClosingRefs('Refs #0\nPart of a/b#0')).toEqual(new Set())
  })

  it('returns an empty set for empty text', () => {
    expect(parseNonClosingRefs('')).toEqual(new Set())
  })
})
