import { describe, expect, it } from 'vitest'
import { PreviewRegistry, type Preview } from './preview-registry.mts'

const preview = (sourceEventId: string): Preview => ({
  sessionId: 's',
  worktree: '/w',
  sourceEventId,
  envelope: {} as Preview['envelope'],
  warnings: [],
})
const scope = (sourceEventId: string) => ({ sessionId: 's', worktree: '/w', sourceEventId })

describe('PreviewRegistry', () => {
  it('mints 32-byte base64url tokens that are taken once', () => {
    const registry = new PreviewRegistry()
    const token = registry.put(preview('a'))
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(registry.put(preview('a'))).not.toBe(token)
    expect(registry.take(token, scope('a'))).toEqual(preview('a'))
    expect(registry.take(token, scope('a'))).toBeUndefined()
  })

  it('keeps a token whose scope does not match', () => {
    const registry = new PreviewRegistry()
    const token = registry.put(preview('a'))
    expect(registry.take(token, scope('b'))).toBeUndefined()
    expect(registry.take(token, { ...scope('a'), sessionId: 'x' })).toBeUndefined()
    expect(registry.take(token, { ...scope('a'), worktree: '/x' })).toBeUndefined()
    expect(registry.take(token, scope('a'))).toBeDefined()
  })

  it('evicts the oldest past its cap, restores, and clears', () => {
    const registry = new PreviewRegistry(2)
    const first = registry.put(preview('a'))
    const second = registry.put(preview('b'))
    const third = registry.put(preview('c'))
    expect(registry.take(first, scope('a'))).toBeUndefined()
    const taken = registry.take(second, scope('b'))!
    registry.restore(second, taken)
    expect(registry.take(second, scope('b'))).toBeDefined()
    registry.clear()
    expect(registry.take(third, scope('c'))).toBeUndefined()
  })
})
