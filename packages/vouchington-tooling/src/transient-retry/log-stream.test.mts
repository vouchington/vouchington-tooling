import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGhLogStreamer, streamGhApiLog, type SpawnGh } from './log-stream.mts'
import { installFakeGh } from './run-context.test-helpers.mts'

async function collect(stream: AsyncIterable<Buffer>): Promise<string> {
  const parts: Buffer[] = []
  for await (const part of stream) parts.push(part)
  return Buffer.concat(parts).toString('utf8')
}

function fakeChild(stdout: string[], stderr: string, code: number | null) {
  const child = Object.assign(new EventEmitter(), {
    stdout: Readable.from(stdout.map((part) => Buffer.from(part))),
    stderr: new Readable({ read() {} }),
    kill: vi.fn(),
  })
  setImmediate(() => {
    child.stderr.push(Buffer.from(stderr))
    child.stderr.push(null)
    child.emit('close', code)
  })
  return child
}

describe('streamGhApiLog with an injected process', () => {
  it('streams stdout chunks and requests escape sequences', async () => {
    const spawnChild = vi.fn(() => fakeChild(['ab', 'cd'], '', 0))
    await expect(collect(streamGhApiLog('repos/a/b', spawnChild as never))).resolves.toBe('abcd')
    expect(spawnChild).toHaveBeenCalledWith(['api', '--allow-escape-sequences', 'repos/a/b'])
  })

  it('throws with bounded stderr on a non-zero exit', async () => {
    const spawnChild: SpawnGh = () => fakeChild(['x'], 'e'.repeat(10_000), 4) as never
    const error = await collect(streamGhApiLog('p', spawnChild)).catch((e: Error) => e)
    expect((error as Error).message).toMatch(/^gh api p exited with status 4: e{4096}$/)
  })

  it('kills the child when the consumer stops early', async () => {
    const child = fakeChild(['ab', 'cd'], '', null)
    const stream = streamGhApiLog('p', (() => child) as never)
    for await (const part of stream) {
      expect(part.toString()).toBe('ab')
      break
    }
    expect(child.kill).toHaveBeenCalledOnce()
  })
})

describe('streamGhApiLog with the real gh on PATH', () => {
  let restore: (() => void) | undefined
  afterEach(() => restore?.())

  it('spawns gh with a scrubbed environment', async () => {
    restore = installFakeGh('echo "$*|${CLICOLOR_FORCE:-unset}"')
    process.env.CLICOLOR_FORCE = '1'
    try {
      await expect(collect(streamGhApiLog('repos/x'))).resolves.toBe(
        'api --allow-escape-sequences repos/x|unset\n',
      )
    } finally {
      delete process.env.CLICOLOR_FORCE
    }
  })

  it('exposes the named token variable to the streaming child as GH_TOKEN', async () => {
    restore = installFakeGh('echo "${GH_TOKEN:-none}"')
    process.env.STREAM_TOKEN_SOURCE = 'streamed-token'
    try {
      await expect(collect(createGhLogStreamer('STREAM_TOKEN_SOURCE')('p'))).resolves.toBe(
        'streamed-token\n',
      )
      await expect(collect(createGhLogStreamer()('p'))).resolves.toBe('none\n')
    } finally {
      delete process.env.STREAM_TOKEN_SOURCE
    }
  })

  it('reports a spawn failure', async () => {
    restore = installFakeGh('exit 3')
    await expect(collect(streamGhApiLog('repos/x'))).rejects.toThrow('exited with status 3')
  })

  it('surfaces a missing gh binary', async () => {
    const path = process.env.PATH
    process.env.PATH = '/nonexistent'
    try {
      await expect(collect(streamGhApiLog('repos/x'))).rejects.toThrow('ENOENT')
    } finally {
      process.env.PATH = path
    }
  })
})
