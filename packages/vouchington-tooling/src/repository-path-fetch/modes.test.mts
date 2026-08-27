import { describe, expect, it } from 'vitest'
import { recordGitMode } from './modes.mts'

describe('recordGitMode', () => {
  it('rejects conflicting ownership for one destination', () => {
    const modes = new Map<string, string>()
    recordGitMode(modes, 'file', '100644')
    expect(() => recordGitMode(modes, 'file', '100755')).toThrow('conflicting Git modes')
    expect(modes.get('file')).toBe('0644')
  })
})
