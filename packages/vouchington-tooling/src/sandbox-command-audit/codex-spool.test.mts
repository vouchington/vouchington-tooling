import { readFile } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createSpool } from './codex-spool.mts'
import { tempDir } from './fixtures.test-helpers.mts'

const failing = vi.hoisted(() => ({ on: false }))

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    createWriteStream: (path: string, options: object) =>
      failing.on
        ? new Writable({ write: (_chunk, _encoding, done) => done(new Error('disk full')) })
        : original.createWriteStream(path, options as never),
  }
})

describe('createSpool', () => {
  it('spools lines to disk, applying backpressure, until closed', async () => {
    failing.on = false
    const spool = await createSpool(tempDir(), 10_000_000)
    for (let index = 0; index < 20; index += 1) await spool.write('x'.repeat(100_000))
    await spool.close()
    expect((await readFile(spool.path, 'utf8')).length).toBe(20 * 100_001)
    await spool.discard()
    await expect(readFile(spool.path)).rejects.toThrow()
  })

  it('refuses a line that passes the byte limit', async () => {
    failing.on = false
    const spool = await createSpool(tempDir(), 5)
    await expect(spool.write('toolong')).rejects.toThrow('exceeds 5 byte limit')
    await spool.discard()
  })

  it('surfaces a stream failure on the write that hits it, the next write, and close', async () => {
    failing.on = true
    const spool = await createSpool(tempDir(), 1000)
    await expect(spool.write('a')).rejects.toThrow('disk full')
    await expect(spool.write('b')).rejects.toThrow('disk full')
    await expect(spool.close()).rejects.toThrow('disk full')
    await spool.discard()
    failing.on = false
  })
})
