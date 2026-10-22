import { describe, expect, it } from 'vitest'

import {
  collectDiagnosticWindow,
  DEFAULT_LOG_LIMITS,
  fitDiagnosticWindow,
  LOG_OMISSION_MARKER,
  type LogLimits,
} from './log-window.mts'

async function* chunks(...parts: string[]): AsyncGenerator<Buffer> {
  for (const part of parts) yield Buffer.from(part)
}

const limits = (overrides: Partial<LogLimits>): LogLimits => ({
  ...DEFAULT_LOG_LIMITS,
  ...overrides,
})

describe('collectDiagnosticWindow', () => {
  it('returns a short log unchanged, even when it spans chunks', async () => {
    const small = limits({ headBytes: 8, tailBytes: 8 })
    await expect(collectDiagnosticWindow(chunks('abc', 'def', 'ghi'), small)).resolves.toBe(
      'abcdefghi',
    )
    await expect(collectDiagnosticWindow(chunks(), small)).resolves.toBe('')
    await expect(collectDiagnosticWindow(chunks('abcdefghijklmnop'), small)).resolves.toBe(
      'abcdefghijklmnop',
    )
  })

  it('keeps only the head and tail of a long log and marks the omission', async () => {
    const small = limits({ headBytes: 4, tailBytes: 5 })
    const text = await collectDiagnosticWindow(chunks('0123', '4567', '89ab', 'cdef'), small)
    expect(text).toBe(`0123${LOG_OMISSION_MARKER}bcdef`)
  })

  it('trims a tail window that cuts into the middle of a chunk', async () => {
    const small = limits({ headBytes: 2, tailBytes: 3 })
    await expect(collectDiagnosticWindow(chunks('abcdefgh'), small)).resolves.toBe(
      `ab${LOG_OMISSION_MARKER}fgh`,
    )
  })

  it('stops reading at maxReadBytes and never keeps more than it read', async () => {
    let produced = 0
    async function* endless(): AsyncGenerator<Buffer> {
      for (;;) {
        produced += 1
        yield Buffer.from('xxxx')
      }
    }
    const capped = limits({ headBytes: 4, tailBytes: 4, maxReadBytes: 10 })
    const text = await collectDiagnosticWindow(endless(), capped)
    expect(produced).toBe(3)
    expect(text).toBe(`xxxx${LOG_OMISSION_MARKER}xxxx`)
  })
})

describe('fitDiagnosticWindow', () => {
  it('returns a log that already fits', () => {
    expect(fitDiagnosticWindow('short', 100)).toBe('short')
  })

  it('keeps a third of the budget at the head and the rest at the tail', () => {
    const markerBytes = Buffer.byteLength(LOG_OMISSION_MARKER)
    const fitted = fitDiagnosticWindow('a'.repeat(100) + 'b'.repeat(100), markerBytes + 30)
    expect(fitted).toBe(`${'a'.repeat(10)}${LOG_OMISSION_MARKER}${'b'.repeat(20)}`)
  })

  it('keeps only the suffix when the budget cannot hold the marker', () => {
    expect(fitDiagnosticWindow('abcdefghij', 4)).toBe('ghij')
  })

  it('treats an unpaired low surrogate as one character', () => {
    expect(fitDiagnosticWindow('\udc00'.repeat(20), 9)).toBe('\udc00'.repeat(3))
  })

  it('never splits a multibyte character or surrogate pair', () => {
    const emoji = '😀'
    expect(Buffer.byteLength(fitDiagnosticWindow(emoji.repeat(10), 9))).toBeLessThanOrEqual(9)
    expect(fitDiagnosticWindow(emoji.repeat(10), 9)).toBe(emoji + emoji)
    const markerBytes = Buffer.byteLength(LOG_OMISSION_MARKER)
    const fitted = fitDiagnosticWindow(emoji.repeat(40), markerBytes + 24)
    expect(fitted).toBe(`${emoji.repeat(2)}${LOG_OMISSION_MARKER}${emoji.repeat(4)}`)
  })
})
