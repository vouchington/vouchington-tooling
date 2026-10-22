import { describe, expect, it, vi } from 'vitest'
import { randomSuffix } from './random-id.mts'

const randomUUID = vi.hoisted(() => vi.fn<() => string>())

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto')
  return { ...actual, randomUUID }
})

describe('randomSuffix', () => {
  it('keeps the first 12 hex characters of a UUID', () => {
    randomUUID.mockReturnValueOnce('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    randomUUID.mockReturnValueOnce('bbbbbbbb-cccc-dddd-eeee-ffffffffffff')

    expect(randomSuffix()).toBe('aaaaaaaabbbb')
    expect(randomSuffix()).toBe('bbbbbbbbcccc')
  })
})
