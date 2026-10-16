import { describe, expect, it } from 'vitest'
import { MAX_RECORDS, createSnapshotRegistry } from './snapshot-registry.mts'

const record = (path: string) => ({ sessionId: 's', worktree: '/w', path })

describe('snapshot registry', () => {
  it('forgets the oldest export beyond its bound and keeps the rest', () => {
    const registry = createSnapshotRegistry()
    const tokens = Array.from({ length: MAX_RECORDS + 1 }, (_, index) =>
      registry.register(record(`/p/${index}`)),
    )
    expect(() => registry.take(tokens[0] as string, 's', '/w')).toThrow('unknown')
    expect(registry.take(tokens[1] as string, 's', '/w').path).toBe('/p/1')
    expect(registry.take(tokens[MAX_RECORDS] as string, 's', '/w').path).toBe(`/p/${MAX_RECORDS}`)
  })

  it('restores a taken record under the same token', () => {
    const registry = createSnapshotRegistry()
    const token = registry.register(record('/p'))
    const taken = registry.take(token, 's', '/w')
    expect(() => registry.take(token, 's', '/w')).toThrow('unknown')
    registry.restore(token, taken)
    expect(registry.take(token, 's', '/w')).toBe(taken)
  })
})
