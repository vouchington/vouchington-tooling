import { describe, expect, it } from 'vitest'
import {
  findIntraBatchCollisions,
  INTRA_DEDUP_THRESHOLD,
  normalizeTitle,
  titleSimilarity,
} from './intra-dedup.mts'

describe('normalizeTitle', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeTitle('Fix the   Login-Bug!!')).toBe('fix the login bug')
  })
})

describe('titleSimilarity', () => {
  it('returns 1 for identical titles', () => {
    expect(titleSimilarity('Fix the login bug', 'Fix the login bug')).toBe(1)
  })

  it('returns 1 for two empty-token titles', () => {
    expect(titleSimilarity('!!!', '???')).toBe(1)
  })

  it('returns 0 when only one title has no tokens', () => {
    expect(titleSimilarity('!!!', 'Fix the login bug')).toBe(0)
  })

  it('computes token-Jaccard similarity for partial overlap', () => {
    // {fix, the, login, bug} vs {fix, the, signup, bug}: intersection 3, union 5
    expect(titleSimilarity('Fix the login bug', 'Fix the signup bug')).toBeCloseTo(3 / 5)
  })

  it('returns 0 for completely disjoint titles', () => {
    expect(titleSimilarity('Fix the login bug', 'Add dark mode toggle')).toBe(0)
  })
})

describe('findIntraBatchCollisions', () => {
  it('returns no collisions when every title is distinct', () => {
    const entries = [
      { id: 'e1', title: 'Fix the login bug' },
      { id: 'e2', title: 'Add dark mode toggle' },
      { id: 'e3', title: 'Improve onboarding copy' },
    ]
    expect(findIntraBatchCollisions(entries)).toEqual([])
  })

  it('flags a pair at or above the threshold and reports both ids', () => {
    const entries = [
      { id: 'e1', title: 'Fix the login bug' },
      { id: 'e2', title: 'Fix the login bug urgently' },
    ]
    const collisions = findIntraBatchCollisions(entries)
    expect(collisions).toHaveLength(1)
    expect(collisions[0]!.a).toBe('e1')
    expect(collisions[0]!.b).toBe('e2')
    expect(collisions[0]!.similarity).toBeGreaterThanOrEqual(INTRA_DEDUP_THRESHOLD)
  })

  it('does not flag a pair below the threshold', () => {
    const entries = [
      { id: 'e1', title: 'Fix the login bug' },
      { id: 'e2', title: 'Fix a totally different signup flow issue' },
    ]
    expect(findIntraBatchCollisions(entries)).toEqual([])
  })

  it('checks every pair, not just adjacent entries, across three or more entries', () => {
    const entries = [
      { id: 'e1', title: 'Fix the login bug' },
      { id: 'e2', title: 'Add dark mode toggle' },
      { id: 'e3', title: 'Fix the login bug again' },
    ]
    const collisions = findIntraBatchCollisions(entries)
    expect(collisions).toHaveLength(1)
    expect(collisions[0]).toMatchObject({ a: 'e1', b: 'e3' })
  })

  it('suppresses a collision when both entries mutually acknowledge each other', () => {
    const entries = [
      {
        id: 'e1',
        title: 'Fix the login bug',
        duplicateSearch: { acknowledgedSiblings: ['e2'] },
      },
      {
        id: 'e2',
        title: 'Fix the login bug urgently',
        duplicateSearch: { acknowledgedSiblings: ['e1'] },
      },
    ]
    expect(findIntraBatchCollisions(entries)).toEqual([])
  })

  it('does not suppress a collision when only one side acknowledges the other', () => {
    const entries = [
      {
        id: 'e1',
        title: 'Fix the login bug',
        duplicateSearch: { acknowledgedSiblings: ['e2'] },
      },
      { id: 'e2', title: 'Fix the login bug urgently' },
    ]
    const collisions = findIntraBatchCollisions(entries)
    expect(collisions).toHaveLength(1)
    expect(collisions[0]).toMatchObject({ a: 'e1', b: 'e2' })
  })

  it('exercises the threshold boundary: exactly at threshold collides, just below does not', () => {
    // {fix,the,login,bug} vs {fix,the,signup,bug}: intersection 3, union 5 => 0.6 (below 0.7)
    expect(
      findIntraBatchCollisions([
        { id: 'e1', title: 'Fix the login bug' },
        { id: 'e2', title: 'Fix the signup bug' },
      ]),
    ).toEqual([])
    // {fix,the,login,bug} vs {fix,login,bug}: intersection 3, union 4 => 0.75 (at/above 0.7)
    const atThreshold = findIntraBatchCollisions([
      { id: 'e1', title: 'Fix the login bug' },
      { id: 'e2', title: 'Fix login bug' },
    ])
    expect(atThreshold).toHaveLength(1)
    expect(atThreshold[0]!.similarity).toBeGreaterThanOrEqual(INTRA_DEDUP_THRESHOLD)
  })
})
