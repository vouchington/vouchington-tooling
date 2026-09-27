import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserConsoleLog } from 'vitest'
import type { SerializedError, TestModule } from 'vitest/node'

import {
  createForkLeakDetector,
  createVitestWorkerExitDiagnosticsReporter,
  clearForkExitRecords,
  formatForkLeakDiagnostics,
  formatWorkerExitDiagnostics,
  isWorkerExitError,
  readForkExitRecords,
  summarizeForkExitRecords,
} from './index.mts'
import { formatForkExitSentinelSection, writeForkExitRecord } from './vitest-fork-exit-records.mts'
import {
  createForkLeakEpisode,
  setForkLeakCandidate,
  takeConfirmedForkLeakCandidate,
} from './vitest-fork-leak-episode.mts'
import {
  collectStringValues,
  serializeDiagnosticsError,
} from './vitest-worker-exit-diagnostics-errors.mts'

const directories: string[] = []

function runSentinelChild(mode: 'exit' | 'uncaught') {
  const directory = mkdtempSync(join(tmpdir(), 'fork-diagnostics-'))
  directories.push(directory)
  const sentinel = new URL('./vitest-fork-exit-sentinel.mts', import.meta.url).href
  const code = `
    import { registerForkExitSentinel, setCurrentForkExitModule, setCurrentForkExitProject }
      from ${JSON.stringify(sentinel)};
    registerForkExitSentinel({ recordDirectory: ${JSON.stringify(directory)} });
    setCurrentForkExitModule('second-consumer.test.mts');
    setCurrentForkExitProject('second-consumer');
    ${mode === 'exit' ? 'process.exit(3);' : "setImmediate(() => { throw new Error('fork failed'); });"}
  `
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', code],
    {
      encoding: 'utf8',
    },
  )
  return { directory, child }
}

describe('fork exit diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true })
  })

  it('persists a real child exit with current module and project attribution', () => {
    const { directory, child } = runSentinelChild('exit')
    expect(child.status).toBe(3)
    expect(child.stderr).toContain('[vitest-fork-exit]')
    const summary = summarizeForkExitRecords(readForkExitRecords(directory))
    expect(summary).toMatchObject({ startedPidCount: 1, forksWithoutExitSentinel: 0 })
    expect(summary.exitRecords).toMatchObject([
      {
        project: 'second-consumer',
        module: 'second-consumer.test.mts',
        mode: 'exit',
        code: 3,
      },
    ])
  })

  it('records an uncaught child failure without turning it into a clean exit', () => {
    const { directory, child } = runSentinelChild('uncaught')
    expect(child.status).toBe(1)
    const summary = summarizeForkExitRecords(readForkExitRecords(directory))
    expect(summary.exitRecords[0]).toMatchObject({ mode: 'uncaught', errorMessage: 'fork failed' })
  })

  it('attributes a fork missing its exit record when the child is killed abruptly', () => {
    const summary = summarizeForkExitRecords([{ kind: 'start', pid: 27 }])
    expect(summary.forksWithoutExitSentinel).toBe(1)
    expect(isWorkerExitError({ cause: { message: 'Worker exited unexpectedly' } })).toBe(true)
    expect(formatWorkerExitDiagnostics('passed', [], [], [], [], summary)).toContain(
      'forks without an exit sentinel: 1',
    )
  })

  it('rejects malformed optional fields and clears only its own regular record files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fork-records-'))
    directories.push(directory)
    const recordFile = join(directory, '123.jsonl')
    const unrelated = join(directory, 'notes.txt')
    const linkedFile = join(directory, '124.jsonl')
    writeFileSync(
      recordFile,
      [
        JSON.stringify({
          kind: 'exit',
          pid: 123,
          project: 'one',
          module: 'one',
          mode: 'exit',
          code: 1,
          errorMessage: {},
        }),
        JSON.stringify({ kind: 'start', pid: 123 }),
      ].join('\n'),
    )
    writeFileSync(unrelated, 'keep')
    symlinkSync(unrelated, linkedFile)

    expect(readForkExitRecords(directory)).toEqual([{ kind: 'start', pid: 123 }])
    clearForkExitRecords(directory)
    expect(existsSync(recordFile)).toBe(false)
    expect(existsSync(unrelated)).toBe(true)
    expect(existsSync(linkedFile)).toBe(true)
    expect(existsSync(directory)).toBe(true)
  })

  it('reports only worker exits with bounded recent module and stderr context', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fork-reporter-'))
    directories.push(directory)
    writeFileSync(join(directory, '123.jsonl'), '{"kind":"start","pid":123}\n')
    const callbacks = createVitestWorkerExitDiagnosticsReporter({
      recordDirectory: directory,
    }) as Required<
      Pick<
        ReturnType<typeof createVitestWorkerExitDiagnosticsReporter>,
        | 'onTestRunStart'
        | 'onTestModuleQueued'
        | 'onTestModuleStart'
        | 'onTestModuleEnd'
        | 'onUserConsoleLog'
        | 'onTestRunEnd'
        | 'onProcessTimeout'
      >
    >
    expect(existsSync(join(directory, '123.jsonl'))).toBe(false)
    const output: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      output.push(String(chunk))
      return true
    })
    callbacks.onTestRunStart([])
    const module = {
      relativeModuleId: 'suite.test.mts',
      moduleId: '/suite.test.mts',
      state: () => 'pending',
    } as unknown as TestModule
    callbacks.onTestModuleQueued(module)
    callbacks.onTestModuleStart(module)
    callbacks.onTestModuleEnd(module)
    callbacks.onUserConsoleLog({ type: 'stdout', content: 'ignored' } as UserConsoleLog)
    callbacks.onUserConsoleLog({ type: 'stderr', content: 'first\nsecond\n' } as UserConsoleLog)
    writeForkExitRecord(directory, { kind: 'start', pid: process.pid })
    const workerError = { message: 'Worker exited unexpectedly' } as SerializedError
    callbacks.onTestRunEnd([module], [{ message: 'ordinary failure' } as SerializedError], 'failed')
    expect(output).toEqual([])
    callbacks.onTestRunEnd([module], [workerError], 'failed')
    expect(output[0]).toContain('queued: suite.test.mts')
    expect(output[0]).toContain('started: suite.test.mts')
    expect(output[0]).toContain('ended: suite.test.mts')
    expect(output[0]).toContain('unfinished modules:')
    expect(output[0]).toContain('first')
    expect(output[0]).toContain('forks started: 1')
    callbacks.onTestRunEnd([module], [workerError], 'failed')
    expect(output).toHaveLength(1)
    callbacks.onProcessTimeout()
    expect(output[1]).toContain('[vitest-worker-timeout]')
    callbacks.onTestRunStart([])
    callbacks.onTestRunEnd([module], [workerError], 'failed')
    expect(output).toHaveLength(3)
  })

  it('requires an explicit record directory', () => {
    expect(() => createVitestWorkerExitDiagnosticsReporter({ recordDirectory: '' })).toThrow(
      'recordDirectory is required',
    )
  })

  it('bounds large diagnostic lists and long error and stderr values', () => {
    const records = Array.from({ length: 21 }, (_, index) => ({
      kind: 'exit' as const,
      pid: index + 1,
      project: 'sample',
      module: 'sample.test.mts',
      mode: 'uncaught' as const,
      code: 1,
      errorMessage: 'bad\nmessage',
      errorStack: 's'.repeat(600),
    }))
    const summary = summarizeForkExitRecords(records)
    const section = formatForkExitSentinelSection(summary).join('\n')
    expect(section).toContain('error: bad message')
    expect(section).toContain('stack:')
    expect(section).toContain('... 1 more')
    expect(
      formatForkExitSentinelSection(
        summarizeForkExitRecords([
          { kind: 'exit', pid: 1, project: 'sample', module: 'one', mode: 'exit', code: 0 },
        ]),
      ).join('\n'),
    ).not.toContain('error:')
    const diagnostics = formatWorkerExitDiagnostics(
      'failed',
      [{ kind: 'queued', moduleId: 'sample.test.mts' }],
      ['x'.repeat(600)],
      Array.from({ length: 3 }, () => ({
        message: 'Worker exited unexpectedly',
        stack: 'x'.repeat(1000),
      })),
      Array.from({ length: 21 }, (_, index) => `unfinished-${index}`),
      summary,
    )
    expect(diagnostics).toContain('1 more unfinished modules')
    expect(diagnostics).toContain('1 more')
    expect(diagnostics).toContain('...')
    expect(isWorkerExitError({ cause: 42 })).toBe(false)
    const resourceSpy = vi
      .spyOn(process, 'getActiveResourcesInfo')
      .mockReturnValue(['Zeta', 'Alpha', 'Zeta'])
    expect(formatWorkerExitDiagnostics('failed', [], [], [], [], summary)).toContain(
      'active resources: Alpha=1 Zeta=2',
    )
    resourceSpy.mockReturnValue([])
    expect(formatWorkerExitDiagnostics('failed', [], [], [], [], summary)).toContain(
      'active resources: none',
    )
  })

  it('keeps only the most recent reporter events and bounds captured stderr', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fork-reporter-bounds-'))
    directories.push(directory)
    const callbacks = createVitestWorkerExitDiagnosticsReporter({
      recordDirectory: directory,
    }) as Required<
      Pick<
        ReturnType<typeof createVitestWorkerExitDiagnosticsReporter>,
        'onTestModuleQueued' | 'onUserConsoleLog' | 'onTestRunEnd'
      >
    >
    const output: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      output.push(String(chunk))
      return true
    })
    for (let index = 0; index < 10; index++) {
      callbacks.onTestModuleQueued({ moduleId: `/module-${index}` } as TestModule)
    }
    for (let index = 0; index < 14; index++) {
      callbacks.onUserConsoleLog({
        type: 'stderr',
        content: `${index}:${'x'.repeat(600)}\n`,
      } as UserConsoleLog)
    }
    callbacks.onTestRunEnd(
      [],
      [{ message: 'Worker exited unexpectedly' } as SerializedError],
      'failed',
    )
    expect(output[0]).not.toContain('queued: /module-0')
    expect(output[0]).toContain('queued: /module-9')
    expect(output[0]).not.toContain('  - 0:')
    expect(output[0]).toContain('  - 13:')
    expect(output[0]).toContain('...')
  })

  it('lists queued modules even without a relative module ID', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fork-queued-'))
    directories.push(directory)
    const callbacks = createVitestWorkerExitDiagnosticsReporter({
      recordDirectory: directory,
    }) as Required<
      Pick<ReturnType<typeof createVitestWorkerExitDiagnosticsReporter>, 'onTestRunEnd'>
    >
    const output: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      output.push(String(chunk))
      return true
    })
    callbacks.onTestRunEnd(
      [
        {
          relativeModuleId: '',
          moduleId: '/queued.test.mts',
          state: () => 'queued',
        } as unknown as TestModule,
        {
          relativeModuleId: '',
          moduleId: '/passed.test.mts',
          state: () => 'passed',
        } as unknown as TestModule,
      ],
      [{ message: 'Worker exited unexpectedly' } as SerializedError],
      'failed',
    )
    expect(output[0]).toContain('/queued.test.mts')
    expect(output[0]).not.toContain('/passed.test.mts')
  })

  it('ignores missing, non-record, oversized, malformed and invalid record files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fork-record-validation-'))
    directories.push(directory)
    expect(readForkExitRecords(join(directory, 'missing'))).toEqual([])
    const source = join(directory, 'plain.txt')
    writeFileSync(source, 'not a record')
    expect(readForkExitRecords(source)).toEqual([])
    writeFileSync(join(directory, '9.jsonl'), 'x'.repeat(1024 * 1024 + 1))
    writeFileSync(join(directory, '10.jsonl'), '{broken\n{"kind":"start","pid":0}\n42\n')
    const unreadable = join(directory, '11.jsonl')
    writeFileSync(unreadable, '{"kind":"start","pid":11}\n')
    chmodSync(unreadable, 0o000)
    expect(readForkExitRecords(directory)).toEqual([])
    chmodSync(unreadable, 0o600)
    writeForkExitRecord(source, { kind: 'start', pid: process.pid })
    expect(readForkExitRecords(source)).toEqual([])
  })

  it('handles a symlinked record directory and circular or scalar error values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fork-record-link-'))
    directories.push(directory)
    const linked = `${directory}-link`
    symlinkSync(directory, linked)
    directories.push(linked)
    writeForkExitRecord(linked, { kind: 'start', pid: process.pid })
    expect(readForkExitRecords(directory)).toEqual([])
    const circular: { cause?: unknown; message: string } = { message: 'Worker exited unexpectedly' }
    circular.cause = circular
    expect(collectStringValues(42)).toEqual(['42'])
    expect(collectStringValues(circular)).toContain('Worker exited unexpectedly')
    expect(serializeDiagnosticsError(null)).toEqual({ value: null })
    expect(serializeDiagnosticsError(circular)).toEqual({
      message: 'Worker exited unexpectedly',
      cause: { circular: true },
    })
  })
})

describe('fork resource growth', () => {
  it('formats fallback source attribution and zero growth', () => {
    const verdict = {
      type: 'MessagePortData',
      baseline: 1,
      current: 1,
      streak: 1,
      growthCheckpoints: 0,
      requiredGrowthCheckpoints: 1,
      detectedInFile: 'detected\nfile',
      suspectedGrowth: null,
    }
    expect(formatForkLeakDiagnostics(verdict)).toContain('file=detected file delta=0')
    expect(formatForkLeakDiagnostics({ ...verdict, detectedInFile: null })).toContain(
      'file=unknown delta=0',
    )
  })

  it('confirms a candidate after a recovery step without replacing stronger growth evidence', () => {
    const episode = createForkLeakEpisode(0, 10, 8, null)
    expect(episode.growthCheckpoints).toBe(0)
    expect(episode.largestGrowthStep).toBeNull()
    setForkLeakCandidate(episode, {
      kind: 'primary',
      age: 1,
      growthCheckpoints: 1,
      highWater: 9,
      suspectedGrowth: { testFile: 'large.test.mts', previous: 0, current: 9, delta: 9 },
    })
    expect(takeConfirmedForkLeakCandidate(episode, 12, 10, 'recovery.test.mts', 3)).toMatchObject({
      suspectedGrowth: { testFile: 'large.test.mts', delta: 9 },
    })
    setForkLeakCandidate(episode, {
      kind: 'primary',
      age: 1,
      growthCheckpoints: 1,
      highWater: 10,
      suspectedGrowth: null,
    })
    expect(takeConfirmedForkLeakCandidate(episode, 10, 11, 'small.test.mts', 3)).toMatchObject({
      suspectedGrowth: { testFile: 'small.test.mts', delta: 1 },
    })
    setForkLeakCandidate(episode, {
      kind: 'primary',
      age: 1,
      growthCheckpoints: 1,
      highWater: 11,
      suspectedGrowth: { testFile: 'large.test.mts', previous: 0, current: 10, delta: 10 },
    })
    expect(takeConfirmedForkLeakCandidate(episode, 11, 12, 'small.test.mts', 3)).toMatchObject({
      suspectedGrowth: { testFile: 'large.test.mts', delta: 10 },
    })
  })

  it('reports sustained growth and attributes the largest step to its source file', () => {
    const detector = createForkLeakDetector({
      trackedTypes: new Set(['MessagePortData']),
      warmupCheckpoints: 1,
      leakThreshold: 0,
      sustainedCheckpoints: 3,
    })
    const samples = [5, 10, 11, 12, 13]
    const verdicts = samples.flatMap((count, index) =>
      detector.record(
        new Map([['MessagePortData', count]]),
        index === 1 ? 'source.test.mts' : 'bystander.test.mts',
      ),
    )
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({
      baseline: 5,
      current: 13,
      suspectedGrowth: { testFile: 'source.test.mts', delta: 5 },
    })
    expect(formatForkLeakDiagnostics(verdicts[0]!)).toContain('file=source.test.mts')
  })

  it('absorbs a stable plateau and ignores a transient spike', () => {
    const detector = createForkLeakDetector({
      trackedTypes: new Set(['MessagePortData']),
      warmupCheckpoints: 1,
      leakThreshold: 0,
      sustainedCheckpoints: 3,
    })
    const counts = [5, 10, 10, 10, 10, 5, 11, 5, 11, 5]
    const verdicts = counts.flatMap((count) =>
      detector.record(new Map([['MessagePortData', count]])),
    )
    expect(verdicts).toEqual([])
  })
})
