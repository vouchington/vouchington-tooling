import { describe, expect, it, vi } from 'vitest'

import { HARD_MAX_DIAGNOSTIC_DIRECTORY_ENTRIES, readDiagnosticReportSummaries } from './index.mts'

const mocks = vi.hoisted(() => {
  let reads = 0
  let closed = false
  return {
    close: vi.fn(() => {
      closed = true
    }),
    isClosed: () => closed,
    read: vi.fn(() => ({ name: `${reads++}.json` })),
    reads: () => reads,
  }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    opendirSync: vi.fn(() => ({ closeSync: mocks.close, readSync: mocks.read })),
  }
})

describe('diagnostic report directory bounds', () => {
  it('aborts and closes a directory that exceeds the entry limit', () => {
    expect(readDiagnosticReportSummaries('/virtual')).toEqual([])
    expect(mocks.reads()).toBe(HARD_MAX_DIAGNOSTIC_DIRECTORY_ENTRIES + 1)
    expect(mocks.isClosed()).toBe(true)
  })
})
