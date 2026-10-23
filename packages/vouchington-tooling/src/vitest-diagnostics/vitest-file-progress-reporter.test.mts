import { mkdtempSync, readFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TestModule, TestModuleState } from 'vitest/node'
import {
  DEFAULT_FILE_PROGRESS_PREFIX,
  createFileProgressWriter,
  createVitestFileProgressReporter,
  formatFileProgress,
  isFileProgressReporter,
} from './vitest-file-progress-reporter.mts'

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  writeSync: vi.fn(),
}))

function testModule(relativeModuleId: string, state: TestModuleState): TestModule {
  return {
    moduleId: `/repo/${relativeModuleId}`,
    relativeModuleId,
    state: () => state,
  } as TestModule
}

describe('file progress reporter', () => {
  it('logs a file when a worker starts it and when it finishes', () => {
    const lines: string[] = []
    const reporter = createVitestFileProgressReporter({
      write: (chunk) => void lines.push(chunk),
      now: () => 1,
    })
    const file = testModule('services/example.test.mts', 'passed')

    reporter.onTestModuleQueued(file)
    reporter.onTestModuleEnd(file)

    expect(lines).toEqual([
      formatFileProgress('start', 'services/example.test.mts', undefined, 1),
      formatFileProgress('finish', 'services/example.test.mts', 'passed', 1),
    ])
    expect(lines[0]).toBe(
      `${DEFAULT_FILE_PROGRESS_PREFIX} event=start module="services/example.test.mts" at=1\n`,
    )
  })

  it('stamps each event with the clock reading and uses a custom prefix', () => {
    const lines: string[] = []
    const ticks = [1_000, 4_500]
    const reporter = createVitestFileProgressReporter({
      write: (chunk) => void lines.push(chunk),
      now: () => ticks.shift()!,
      prefix: '[custom]',
    })
    const file = testModule('a.test.mts', 'passed')

    reporter.onTestModuleQueued(file)
    reporter.onTestModuleEnd(file)

    expect(lines[0]).toBe('[custom] event=start module="a.test.mts" at=1000\n')
    expect(lines[1]).toBe('[custom] event=finish module="a.test.mts" state=passed at=4500\n')
  })

  it('falls back to the absolute module id', () => {
    const lines: string[] = []
    const reporter = createVitestFileProgressReporter({ write: (chunk) => void lines.push(chunk) })
    reporter.onTestModuleQueued({ moduleId: '/abs/x.mts', relativeModuleId: '' } as TestModule)
    expect(lines[0]).toContain('module="/abs/x.mts"')
  })

  it('truncates long module ids and ignores invalid state and timestamps', () => {
    const line = formatFileProgress('finish', 'x'.repeat(500), 'Bad State', 1.5)
    expect(line).toContain('…')
    expect(line).not.toContain('state=')
    expect(line).not.toContain('at=')
    expect(line.length).toBeLessThan(450)
  })

  it('writes to stdout by default', () => {
    createVitestFileProgressReporter({ now: () => 5 }).onTestModuleQueued(
      testModule('a.mts', 'passed'),
    )
    expect(writeSync).toHaveBeenCalledWith(
      process.stdout.fd,
      `${DEFAULT_FILE_PROGRESS_PREFIX} event=start module="a.mts" at=5\n`,
    )
  })

  it('appends each chunk to the progress file', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'progress-')), 'progress.log')
    const write = createFileProgressWriter(file)
    write('a\n')
    write('b\n')
    expect(readFileSync(file, 'utf8')).toBe('a\nb\n')
  })

  it('recognizes only its own reporter', () => {
    expect(isFileProgressReporter(createVitestFileProgressReporter())).toBe(true)
    expect(isFileProgressReporter({})).toBe(false)
  })
})
