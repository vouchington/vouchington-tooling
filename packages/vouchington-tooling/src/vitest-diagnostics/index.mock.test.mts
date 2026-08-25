import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readDiagnosticReportSummaries } from './index.mts'

const mocks = vi.hoisted(() => ({ read: vi.fn((_fd, buffer: Buffer) => buffer.length) }))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, readSync: mocks.read }
})

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('diagnostic report read races', () => {
  it('rejects a report that grows beyond the byte limit after fstat', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vitest-diagnostics-race-'))
    directories.push(directory)
    writeFileSync(join(directory, 'growing.json'), '{}')

    expect(readDiagnosticReportSummaries(directory)).toEqual([])
  })
})
