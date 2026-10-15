import { describe, expect, it } from 'vitest'
import { classifyFreshBase, relationOf } from './classify.mts'
import type { FreshBaseInput } from './classify.mts'

const clean: FreshBaseInput = { ahead: 0, behind: 0, tree: 'clean', fetch: 'fresh' }

describe('relationOf', () => {
  it('derives the relation from ahead and behind counts', () => {
    expect(relationOf(0, 0)).toBe('matches')
    expect(relationOf(0, 3)).toBe('behind')
    expect(relationOf(2, 0)).toBe('ahead')
    expect(relationOf(2, 3)).toBe('diverged')
    expect(relationOf(null, 0)).toBe('unknown')
    expect(relationOf(0, null)).toBe('unknown')
  })
})

describe('classifyFreshBase', () => {
  it('reports a clean matching worktree as up to date, fetched or skipped', () => {
    expect(classifyFreshBase(clean)).toMatchObject({ status: 'up-to-date', needsAttention: false })
    expect(classifyFreshBase({ ...clean, fetch: 'skipped' }).status).toBe('up-to-date')
  })

  it('reports ahead, behind, and diverged regardless of tree state', () => {
    expect(classifyFreshBase({ ...clean, ahead: 2 }).status).toBe('ahead')
    expect(classifyFreshBase({ ...clean, behind: 2, tree: 'dirty' })).toMatchObject({
      status: 'behind',
      relation: 'behind',
      needsAttention: true,
    })
    expect(classifyFreshBase({ ...clean, ahead: 1, behind: 1 }).status).toBe('diverged')
  })

  it('reports dirty only when the commits match the base', () => {
    expect(classifyFreshBase({ ...clean, tree: 'dirty' }).status).toBe('dirty')
  })

  it('lets a failed refresh outrank every other status', () => {
    for (const input of [clean, { ...clean, ahead: 1 }, { ...clean, tree: 'dirty' as const }]) {
      expect(classifyFreshBase({ ...input, fetch: 'failed' }).status).toBe('fetch-failed')
    }
    expect(classifyFreshBase({ ...clean, ahead: null, behind: null, fetch: 'failed' }).status).toBe(
      'fetch-failed',
    )
  })

  it('reports unknown when the comparison or the tree state is unavailable', () => {
    expect(classifyFreshBase({ ...clean, ahead: null, behind: null }).status).toBe('unknown')
    expect(classifyFreshBase({ ...clean, tree: 'unknown' })).toMatchObject({
      status: 'unknown',
      needsAttention: true,
    })
  })
})
