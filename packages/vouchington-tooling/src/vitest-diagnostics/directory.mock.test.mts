import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HARD_MAX_DIAGNOSTIC_DIRECTORY_ENTRIES, readDiagnosticReportSummaries } from './index.mts'

const mocks = vi.hoisted(() => {
  let reads = 0
  let closed = false
  return {
    close: vi.fn(() => {
      closed = true
    }),
    isClosed: () => closed,
    lstat: vi.fn(),
    read: vi.fn<() => { name: string } | null>(() => ({ name: `${reads++}.json` })),
    reads: () => reads,
    reset: () => {
      closed = false
      reads = 0
      mocks.close.mockClear()
      mocks.lstat.mockReset().mockReturnValue({ dev: 1, ino: 1, isDirectory: () => true })
      mocks.read.mockReset().mockImplementation(() => ({ name: `${reads++}.json` }))
    },
  }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    lstatSync: mocks.lstat,
    opendirSync: vi.fn(() => ({ closeSync: mocks.close, readSync: mocks.read })),
  }
})

describe('diagnostic report directory bounds', () => {
  beforeEach(() => {
    mocks.reset()
  })

  it('aborts and closes a directory that exceeds the entry limit', () => {
    expect(readDiagnosticReportSummaries('/virtual')).toEqual([])
    expect(mocks.reads()).toBe(HARD_MAX_DIAGNOSTIC_DIRECTORY_ENTRIES + 1)
    expect(mocks.isClosed()).toBe(true)
  })

  it('rejects a directory replaced after enumeration before opening a report', () => {
    const original = { dev: 1, ino: 1, isDirectory: () => true }
    const replacement = { dev: 1, ino: 2, isDirectory: () => true }
    mocks.read
      .mockImplementationOnce(() => ({ name: 'report.json' }))
      .mockImplementationOnce(() => null)
    mocks.lstat.mockReturnValueOnce(original).mockReturnValueOnce(replacement)

    expect(readDiagnosticReportSummaries('/virtual')).toEqual([])
    expect(mocks.lstat).toHaveBeenCalledTimes(2)
  })
})
