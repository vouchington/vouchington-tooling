import { describe, expect, it } from 'vitest'
import { recordGitMode } from './modes.mts'

describe('recordGitMode', () => {
  it.each(['100644', '100755'])('rejects duplicate ownership with source mode %s', (mode) => {
    const modes = new Map<string, string>()
    recordGitMode(modes, 'file', '100644')
    expect(() => recordGitMode(modes, 'file', mode)).toThrow('duplicate bundle destination')
    expect(modes.get('file')).toBe('0644')
  })
})
