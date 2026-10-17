import { describe, expect, it } from 'vitest'

import { scanJournal } from './journal.mts'
import { validateSessionId } from './session-id.mts'
import { fitUnits, isWellFormedUnicode } from './text.mts'
import type { JournalEntry } from './types.mts'

const block = 'markdown block'
const journalEntry = (markdown: unknown): JournalEntry => ({ data: { type: 'journal', markdown } })

describe('scanJournal', () => {
  it('reports not-found and unreachable loaders', async () => {
    expect(await scanJournal('s', () => ({ status: 'not-found' }))).toEqual({ status: 'not-found' })
    expect(
      await scanJournal('s', async () => {
        throw new Error('down')
      }),
    ).toEqual({ status: 'unreachable', diagnostic: 'down' })
    expect(
      await scanJournal('s', () => {
        throw 'plain'
      }),
    ).toEqual({ status: 'unreachable', diagnostic: 'plain' })
  })

  it('handles an unprintable thrown value without rejecting', async () => {
    const unprintable = Object.create(null) as { toString(): string }
    Object.defineProperty(unprintable, 'toString', {
      value() {
        throw new Error('cannot stringify')
      },
    })
    expect(
      await scanJournal('s', async () => {
        throw unprintable
      }),
    ).toEqual({ status: 'unreachable', diagnostic: '[unprintable error]' })
  })

  it('retains only journal markdown and supports an async iterable', async () => {
    const result = await scanJournal('s', () => ({
      status: 'ok',
      entries: (async function* () {
        yield journalEntry(block)
        yield { data: { type: 'retrospective', markdown: 'ignored' } }
      })(),
    }))
    expect(result).toEqual({ status: 'ok', entries: [journalEntry(block)], truncated: false })
  })

  it('skips hostile entry getters while retaining later evidence', async () => {
    const hostile = Object.defineProperty({}, 'data', {
      get: () => {
        throw new Error('hostile getter')
      },
    }) as JournalEntry
    const result = await scanJournal('s', () => ({
      status: 'ok',
      entries: [{}, null as unknown as JournalEntry, hostile, journalEntry(block)],
    }))
    expect(result).toEqual({ status: 'ok', entries: [journalEntry(block)], truncated: true })
  })

  it('marks non-string journal markdown and oversized markdown as truncated', async () => {
    const result = await scanJournal('s', () => ({
      status: 'ok',
      entries: [journalEntry(42), journalEntry('x'.repeat(10_001))],
    }))
    expect(result).toEqual({ status: 'ok', entries: [], truncated: true })
  })

  it('bounds the entries consumed from an iterable', async () => {
    let consumed = 0
    let closed = false
    const result = await scanJournal('s', () => ({
      status: 'ok',
      entries: (function* () {
        try {
          while (true) {
            consumed++
            yield { data: { type: 'retrospective' } }
          }
        } finally {
          closed = true
        }
      })(),
    }))
    expect(consumed).toBe(500)
    expect(closed).toBe(true)
    expect(result).toMatchObject({ status: 'ok', truncated: true })
  })

  it('bounds the bytes inspected from rejected markdown', async () => {
    let consumed = 0
    await scanJournal('s', () => ({
      status: 'ok',
      entries: (function* () {
        while (true) {
          consumed++
          yield journalEntry('😀'.repeat(5_001))
        }
      })(),
    }))
    expect(consumed).toBe(50)
  })

  it('stops retaining markdown at the aggregate byte budget', async () => {
    const chunk = 'y'.repeat(9_999)
    const result = await scanJournal('s', () => ({
      status: 'ok',
      entries: Array.from({ length: 101 }, () => journalEntry(chunk)),
    }))
    expect(result).toMatchObject({ status: 'ok', truncated: true })
    if (result.status === 'ok') expect(result.entries.length).toBeLessThanOrEqual(100)
  })
})

describe('validateSessionId', () => {
  it('rejects non-strings, oversized, ill-formed, and empty ids', () => {
    expect(() => validateSessionId(42 as unknown as string)).toThrow(/must be a string/)
    expect(() => validateSessionId('x'.repeat(4097))).toThrow(/too long/)
    expect(() => validateSessionId('\ud800')).toThrow(/well-formed/)
    expect(() => validateSessionId(' ​ ')).toThrow(/non-empty/)
    expect(() => validateSessionId('native:owner')).not.toThrow()
  })
})

describe('isWellFormedUnicode', () => {
  it('accepts pairs and rejects lone surrogates', () => {
    expect(isWellFormedUnicode('a😀')).toBe(true)
    expect(isWellFormedUnicode('\ud800a')).toBe(false)
    expect(isWellFormedUnicode('\udc00')).toBe(false)
  })
})

describe('fitUnits', () => {
  it('keeps whole units that fit and cuts others at whitespace tokens', () => {
    const units = Array.from('alpha beta gamma')
    expect(fitUnits(units, 100)).toBe('alpha beta gamma')
    expect(fitUnits(units, 12)).toBe('alpha …')
    expect(fitUnits(Array.from('abcdefghij'), 5)).toBe('…')
  })
})
