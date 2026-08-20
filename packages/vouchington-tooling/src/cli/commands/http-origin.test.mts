import { afterEach, describe, expect, it, vi } from 'vitest'

import { runCli } from '../index.mts'
import { runHttpOrigin } from './http-origin.mts'

describe('http-origin CLI', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stderr.mockClear()
  })

  it('accepts an empty value and a pure origin', () => {
    expect(runHttpOrigin('origin', '')).toBe(0)
    expect(runHttpOrigin('cdn_origin', 'https://images.example.com')).toBe(0)
  })

  it('prints the field-specific error and returns 1', () => {
    expect(runHttpOrigin('cdn_origin', 'https://images.example.com/path')).toBe(1)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('cdn_origin must be empty')
  })

  it('dispatches through runCli', () => {
    expect(runCli(['node', 'vouchington', 'http-origin', 'https://images.example.com'])).toBe(0)
    expect(
      runCli(['node', 'vouchington', 'http-origin', '--field', 'cdn_origin', 'ftp://x.example']),
    ).toBe(1)
  })
})
