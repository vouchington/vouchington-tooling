import { describe, expect, it } from 'vitest'

import * as transcript from './index.mts'

describe('retrospective-transcript exports', () => {
  it('exports the command and streaming helpers', () => {
    expect(transcript.normalizeCommandPrefix('CI=1 pnpm exec vitest')).toBe('pnpm exec vitest')
    expect(transcript.splitCommandSegments('a && b')).toEqual([['a'], ['b']])
    expect(transcript.isPackageRunner('pnpm')).toBe(true)
    expect(transcript.asRecord({ a: 1 })).toEqual({ a: 1 })
    expect(transcript.asRecord([])).toBeUndefined()
    expect(transcript.asArray([1])).toEqual([1])
    expect(transcript.DEFAULT_MAX_RECORD_BYTES).toBe(2 * 1024 * 1024)
    expect(typeof transcript.openTranscriptLines).toBe('function')
  })
})
