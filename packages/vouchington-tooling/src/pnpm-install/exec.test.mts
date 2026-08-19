import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('./process.mts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process.mts')>()
  return {
    ...actual,
    terminateSafeProcessGroup: vi.fn(actual.terminateSafeProcessGroup),
  }
})

import { spawn } from 'node:child_process'
import { INSTALL_TERMINATION_FAILED, terminateSafeProcessGroup } from './process.mts'
import { runPnpm } from './exec.mts'

const mockedSpawn = vi.mocked(spawn)

type FakeChild = EventEmitter & {
  pid?: number
  stdout: EventEmitter
  stderr: EventEmitter
}

function child(pid = 42): FakeChild {
  const emitter = new EventEmitter() as FakeChild
  emitter.pid = pid
  emitter.stdout = new EventEmitter()
  emitter.stderr = new EventEmitter()
  return emitter
}

const options = {
  commandTimeoutSeconds: 0,
  ephemeralWorkspaces: '',
  installScripts: true,
  maxAttempts: 1,
  runnerLifecycle: 'persistent' as const,
}

describe('runPnpm', () => {
  afterEach(() => {
    mockedSpawn.mockReset()
  })

  it('captures and forwards stdout and stderr', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const proc = child()
    mockedSpawn.mockReturnValue(proc as never)
    const pending = runPnpm(['install'], options)
    proc.stdout.emit('data', Buffer.from('out'))
    proc.stderr.emit('data', Buffer.from('err'))
    proc.emit('close', 0)
    await expect(pending).resolves.toMatchObject({ code: 0, output: 'out', errorOutput: 'err' })
    expect(stdout).toHaveBeenCalled()
    expect(stderr).toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })

  it('does not forward streams when capturing', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const proc = child()
    mockedSpawn.mockReturnValue(proc as never)
    const pending = runPnpm(['m', 'ls'], options, true)
    proc.stdout.emit('data', Buffer.from('[]'))
    proc.emit('close', 0)
    await expect(pending).resolves.toMatchObject({ output: '[]' })
    expect(stdout).not.toHaveBeenCalled()
    stdout.mockRestore()
  })

  it('reports spawn throws and start errors', async () => {
    mockedSpawn.mockImplementation(() => {
      throw 'spawn exploded'
    })
    await expect(runPnpm(['install'], options)).resolves.toMatchObject({
      code: 1,
      errorOutput: 'spawn exploded',
    })
    mockedSpawn.mockImplementation(() => {
      throw new Error('spawn exploded')
    })
    await expect(runPnpm(['install'], options)).resolves.toMatchObject({
      code: 1,
      errorOutput: 'spawn exploded',
    })
    const proc = child()
    mockedSpawn.mockReturnValue(proc as never)
    const pending = runPnpm(['install'], options)
    proc.emit('error', new Error('enoent'))
    await expect(pending).resolves.toMatchObject({ code: 1, errorOutput: 'enoent' })
  })

  it('times out and maps a failed termination to INSTALL_TERMINATION_FAILED', async () => {
    vi.useFakeTimers()
    const proc = child()
    mockedSpawn.mockReturnValue(proc as never)
    const pending = runPnpm(['install'], { ...options, commandTimeoutSeconds: 1 })
    const result = pending
    await vi.advanceTimersByTimeAsync(1000)
    proc.emit('close', 0)
    await expect(result).resolves.toMatchObject({ code: expect.any(Number) })
    vi.useRealTimers()
  })

  it('ignores a timeout after the child has already closed', async () => {
    vi.useFakeTimers()
    const proc = child()
    mockedSpawn.mockReturnValue(proc as never)
    const pending = runPnpm(['install'], { ...options, commandTimeoutSeconds: 1 })
    proc.emit('close', 0)
    await expect(pending).resolves.toMatchObject({ code: 0 })
    await vi.advanceTimersByTimeAsync(1000)
    vi.useRealTimers()
  })

  it('maps a thrown termination to INSTALL_TERMINATION_FAILED', async () => {
    vi.useFakeTimers()
    const proc = child()
    mockedSpawn.mockReturnValue(proc as never)
    vi.mocked(terminateSafeProcessGroup).mockRejectedValueOnce(new Error('term failed'))
    const pending = runPnpm(['install'], { ...options, commandTimeoutSeconds: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toMatchObject({ code: INSTALL_TERMINATION_FAILED })
    vi.useRealTimers()
  })

  it('treats a spawn without a pid as an unsafe timeout', async () => {
    vi.useFakeTimers()
    const proc = child()
    delete proc.pid
    mockedSpawn.mockReturnValue(proc as never)
    const pending = runPnpm(['install'], { ...options, commandTimeoutSeconds: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toMatchObject({ code: INSTALL_TERMINATION_FAILED })
    vi.useRealTimers()
  })
})
