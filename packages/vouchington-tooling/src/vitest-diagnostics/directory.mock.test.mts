import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HARD_MAX_DIAGNOSTIC_DIRECTORY_ENTRIES, readDiagnosticReportSummaries } from './index.mts'

const mocks = vi.hoisted(() => {
  let reads = 0
  let closed = false
  return {
    close: vi.fn(() => {
      closed = true
    }),
    closeFile: vi.fn(),
    fileRead: vi.fn<() => number>(() => 0),
    fstat: vi.fn(),
    isClosed: () => closed,
    lstat: vi.fn(),
    open: vi.fn(),
    read: vi.fn<() => { name: string } | null>(() => ({ name: `${reads++}.json` })),
    reads: () => reads,
    reset: () => {
      closed = false
      reads = 0
      mocks.close.mockClear()
      mocks.closeFile.mockReset()
      mocks.fileRead.mockReset().mockReturnValue(0)
      mocks.fstat.mockReset().mockReturnValue({ dev: 2, ino: 2, isFile: () => true, size: 0 })
      mocks.lstat.mockReset().mockReturnValue({ dev: 1, ino: 1, isDirectory: () => true })
      mocks.open.mockReset().mockReturnValue(1)
      mocks.read.mockReset().mockImplementation(() => ({ name: `${reads++}.json` }))
    },
  }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    closeSync: mocks.closeFile,
    fstatSync: mocks.fstat,
    lstatSync: mocks.lstat,
    openSync: mocks.open,
    opendirSync: vi.fn(() => ({ closeSync: mocks.close, readSync: mocks.read })),
    readSync: mocks.fileRead,
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

  it('rejects a selected path that is not a directory', () => {
    mocks.lstat.mockReturnValue({ dev: 1, ino: 1, isDirectory: () => false })

    expect(readDiagnosticReportSummaries('/virtual')).toEqual([])
    expect(mocks.read).not.toHaveBeenCalled()
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

  it('rejects a directory that disappears before a selected report opens', () => {
    const directory = { dev: 1, ino: 1, isDirectory: () => true }
    mocks.read
      .mockImplementationOnce(() => ({ name: 'report.json' }))
      .mockImplementationOnce(() => null)
    mocks.lstat
      .mockReturnValueOnce(directory)
      .mockReturnValueOnce(directory)
      .mockImplementationOnce(() => {
        throw new Error('directory disappeared')
      })

    expect(readDiagnosticReportSummaries('/virtual')).toEqual([])
  })

  it('rejects a directory replaced while reading a selected report', () => {
    const directory = { dev: 1, ino: 1, isDirectory: () => true }
    const file = { dev: 2, ino: 2, isFile: () => true, isSymbolicLink: () => false }
    const replacement = { dev: 1, ino: 2, isDirectory: () => true }
    mocks.read
      .mockImplementationOnce(() => ({ name: 'report.json' }))
      .mockImplementationOnce(() => null)
    mocks.lstat
      .mockReturnValueOnce(directory)
      .mockReturnValueOnce(directory)
      .mockReturnValueOnce(directory)
      .mockReturnValueOnce(file)
      .mockReturnValueOnce(file)
      .mockReturnValueOnce(replacement)

    expect(readDiagnosticReportSummaries('/virtual')).toEqual([])
    expect(mocks.open).toHaveBeenCalledOnce()
  })
})
