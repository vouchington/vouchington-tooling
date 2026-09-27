import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ maximumRead: 0, failure: '', directorySyncs: 0 }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readSync: (...args: Parameters<typeof actual.readSync>) => {
      state.maximumRead = Math.max(state.maximumRead, args[1].byteLength)
      return actual.readSync(...args)
    },
    writeSync: (...args: Parameters<typeof actual.writeSync>) => {
      if (state.failure === 'write') throw new Error('controlled write failure')
      return actual.writeSync(...args)
    },
    renameSync: (from: import('node:fs').PathLike, to: import('node:fs').PathLike) => {
      if (state.failure === 'rename') throw new Error('controlled rename failure')
      return actual.renameSync(from, to)
    },
    fsyncSync: (descriptor: number) => {
      const directory = actual.fstatSync(descriptor).isDirectory()
      if (directory) state.directorySyncs++
      if (
        state.failure === (directory ? 'directorySync' : 'fileSync') &&
        (!directory || state.directorySyncs === 2)
      )
        throw new Error('controlled sync failure')
      return actual.fsyncSync(descriptor)
    },
  }
})
import { buildSessionFrictionReport, readFrictionLog, recordFriction } from './index.mts'
const directories: string[] = []
const observation = { type: 'permission-request' as const, command: 'git push' }
afterEach(async () => {
  state.failure = ''
  state.maximumRead = 0
  state.directorySyncs = 0
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'friction-counter-io-'))
  directories.push(directory)
  const options = { directory, maxEvents: 1 }
  recordFriction('owner', observation, options)
  recordFriction('owner', observation, options)
  return options
}
it('reads only bounded counter bytes for every subsequent saturated capture', async () => {
  const options = await fixture()
  state.maximumRead = 0
  for (let index = 0; index < 20; index++) recordFriction('owner', observation, options)
  expect(state.maximumRead).toBeGreaterThan(0)
  expect(state.maximumRead).toBeLessThanOrEqual(193)
  expect(readFrictionLog('owner', options)).toMatchObject({ droppedCount: 21 })
})
it.each(['write', 'fileSync', 'rename', 'directorySync'])(
  'preserves evidence of interrupted %s updates',
  async (failure) => {
    const options = await fixture()
    state.failure = failure
    state.directorySyncs = 0
    expect(() => recordFriction('owner', observation, options)).toThrow(/controlled/)
    state.failure = ''
    const interrupted = failure !== 'directorySync'
    expect((await readdir(options.directory)).some((name) => name.endsWith('.pending'))).toBe(
      interrupted,
    )
    if (interrupted) {
      expect(() => readFrictionLog('owner', options)).toThrow(/coverage update is incomplete/)
      expect(() => recordFriction('owner', observation, options)).toThrow(
        /coverage update is incomplete/,
      )
    } else {
      expect(readFrictionLog('owner', options)).toMatchObject({ droppedCount: 2 })
      recordFriction('owner', observation, options)
      expect(readFrictionLog('owner', options)).toMatchObject({ droppedCount: 3 })
    }
  },
)
it.each(['write', 'fileSync', 'rename'])(
  'never claims complete when the first dropped-capture %s persistence fails',
  async (failure) => {
    const directory = await mkdtemp(join(tmpdir(), 'friction-first-drop-failure-'))
    directories.push(directory)
    const options = { directory, maxEvents: 1 }
    recordFriction('owner', observation, options)
    state.failure = failure
    state.directorySyncs = 0
    expect(() => recordFriction('owner', observation, options)).toThrow(/controlled/)
    state.failure = ''
    expect(() => readFrictionLog('owner', options)).toThrow(/coverage update is incomplete/)
    const report = await buildSessionFrictionReport('owner', {
      ...options,
      journalLoader: () => ({ status: 'not-found' }),
    })
    expect(report.coverage).toMatchObject({ frictionStatus: 'unreadable', truncated: true })
    expect(report.markdown).toContain('Status: unavailable')
  },
)
