import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  collectChildStream,
  executePnpm,
  signalFromAbort,
  stopChildProcess,
} from './execute-pnpm.mts'

const commandOptions = (signal: AbortSignal) => ({
  cwd: tmpdir(),
  encoding: 'utf8' as const,
  signal,
})

describe('pnpm execution', () => {
  it('maps abort reasons onto the signal forwarded to the child', () => {
    for (const signalName of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      const controller = new AbortController()
      controller.abort(signalName)
      expect(signalFromAbort(controller.signal)).toBe(signalName)
    }
    expect(signalFromAbort(new AbortController().signal)).toBe('SIGTERM')
  })

  it('kills a missing process group through the child and skips an unknown pid', () => {
    const groupSignals: NodeJS.Signals[] = []
    stopChildProcess(
      {
        pid: 2_147_483_647,
        kill: (signal) => {
          if (signal) groupSignals.push(signal)
          return true
        },
      },
      'SIGTERM',
    )
    expect(groupSignals).toEqual(['SIGTERM'])
    const directSignals: NodeJS.Signals[] = []
    stopChildProcess(
      {
        kill: (signal) => {
          if (signal) directSignals.push(signal)
          return true
        },
      },
      'SIGHUP',
    )
    expect(directSignals).toEqual(['SIGHUP'])
  })

  it('rejects a missing stdio pipe and records stream text', () => {
    expect(() => collectChildStream(null, [], () => undefined)).toThrow(/stdio pipe/)
    const stream = new PassThrough()
    const chunks: string[] = []
    let overflowed = false
    collectChildStream(stream, chunks, () => {
      overflowed = true
    })
    stream.write('ok')
    expect(chunks).toEqual(['ok'])
    expect(overflowed).toBe(false)
  })

  it('returns stdout and stderr from a successful command', async () => {
    const result = await executePnpm(
      process.execPath,
      ['-e', "process.stdout.write('out'); process.stderr.write('err')"],
      commandOptions(new AbortController().signal),
    )
    expect(result).toMatchObject({ status: 0, stdout: 'out', stderr: 'err' })
  })

  it('returns a non-zero status and a spawn error', async () => {
    const failed = await executePnpm(
      process.execPath,
      ['-e', 'process.exit(3)'],
      commandOptions(new AbortController().signal),
    )
    expect(failed.status).toBe(3)
    const missing = await executePnpm(
      'license-audit-missing-binary',
      [],
      commandOptions(new AbortController().signal),
    )
    expect(missing.error).toBeInstanceOf(Error)
    expect(missing.status).toBeNull()
  })

  it('stops a child that is already aborted or aborted while running', async () => {
    const aborted = new AbortController()
    aborted.abort('SIGTERM')
    const already = await executePnpm(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      commandOptions(aborted.signal),
    )
    expect(already.status).not.toBe(0)

    const controller = new AbortController()
    const pending = executePnpm(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      commandOptions(controller.signal),
    )
    controller.abort('SIGINT')
    const stopped = await pending
    expect(stopped.status).not.toBe(0)
  })

  it('fails when the child exceeds the output buffer', async () => {
    const result = await executePnpm(
      process.execPath,
      ['-e', `process.stdout.write('x'.repeat(${1024 * 1024 + 1}))`],
      commandOptions(new AbortController().signal),
    )
    expect(result.error).toMatchObject({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
  })
})
