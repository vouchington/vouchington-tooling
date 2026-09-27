import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

import { DiffCommandError, processDiffCommand } from './diff.mts'

describe('processDiffCommand stream failures', () => {
  it('wraps a stdout stream failure as a typed command error after cleanup', async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null
      killed: boolean
      kill: (signal: NodeJS.Signals) => boolean
      stderr: EventEmitter
      stdout: Readable
    }
    child.exitCode = null
    child.killed = false
    child.stdout = new Readable({ read() {} })
    child.stderr = new EventEmitter()
    child.kill = vi.fn(() => {
      child.killed = true
      child.stdout.destroy()
      queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
      return true
    })
    vi.mocked(spawn).mockReturnValueOnce(child as never)
    const running = processDiffCommand({ executable: 'git', args: ['diff'] }, () => undefined)
    child.stdout.destroy(new Error('stdout failed'))
    const failure = await running.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DiffCommandError)
    expect(failure).toMatchObject({ cause: { message: 'stdout failed' } })
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('wraps a stderr stream failure as a typed command error after cleanup', async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null
      killed: boolean
      kill: (signal: NodeJS.Signals) => boolean
      stderr: EventEmitter
      stdout: Readable
    }
    child.exitCode = null
    child.killed = false
    child.stdout = new Readable({ read() {} })
    child.stderr = new EventEmitter()
    child.kill = vi.fn(() => {
      child.killed = true
      child.stdout.destroy()
      queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
      return true
    })
    vi.mocked(spawn).mockReturnValueOnce(child as never)
    const running = processDiffCommand({ executable: 'git', args: ['diff'] }, () => undefined)
    child.stderr.emit('error', new Error('stderr failed'))
    const failure = await running.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DiffCommandError)
    expect(failure).toMatchObject({ cause: { message: 'stderr failed' } })
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('reports a stderr failure observed as stdout ends before the final block callback', async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null
      killed: boolean
      kill: (signal: NodeJS.Signals) => boolean
      stderr: EventEmitter
      stdout: Readable
    }
    child.exitCode = null
    child.killed = false
    child.stdout = new Readable({ read() {} })
    child.stderr = new EventEmitter()
    child.kill = vi.fn(() => {
      child.killed = true
      child.stdout.destroy()
      queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
      return true
    })
    child.stdout.once('end', () => child.stderr.emit('error', new Error('stderr ended')))
    vi.mocked(spawn).mockReturnValueOnce(child as never)
    const running = processDiffCommand({ executable: 'git', args: ['diff'] }, () => undefined)
    child.stdout.push('diff --git a/x b/x\n')
    child.stdout.push(null)
    const failure = await running.catch((error: unknown) => error)
    expect(failure).toMatchObject({ cause: { message: 'stderr ended' } })
  })

  it('reports a stderr failure observed after the final block callback', async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null
      killed: boolean
      kill: (signal: NodeJS.Signals) => boolean
      stderr: EventEmitter
      stdout: Readable
    }
    child.exitCode = null
    child.killed = false
    child.stdout = new Readable({ read() {} })
    child.stderr = new EventEmitter()
    child.kill = vi.fn(() => {
      child.killed = true
      child.stdout.destroy()
      queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
      return true
    })
    vi.mocked(spawn).mockReturnValueOnce(child as never)
    const running = processDiffCommand({ executable: 'git', args: ['diff'] }, () => {
      child.stderr.emit('error', new Error('stderr after block'))
    })
    child.stdout.push('diff --git a/x b/x\n')
    child.stdout.push(null)
    const failure = await running.catch((error: unknown) => error)
    expect(failure).toMatchObject({ cause: { message: 'stderr after block' } })
  })
})
