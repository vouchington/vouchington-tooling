import { createReadStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})

const { openTranscriptLines } = await import('./transcript-lines.mts')

const dirs: string[] = []

describe('openTranscriptLines cancellation', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('closes the stream when an unstarted iterator is cancelled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'transcript-cancel-'))
    dirs.push(dir)
    const path = join(dir, 'transcript.jsonl')
    await writeFile(path, 'one\ntwo\n', 'utf8')

    const opened = await openTranscriptLines(path)
    if ('error' in opened) throw new Error(opened.error)
    const stream = vi.mocked(createReadStream).mock.results[0]?.value as ReturnType<
      typeof createReadStream
    >
    expect(stream.destroyed).toBe(false)
    const iterator = opened.lines[Symbol.asyncIterator]()
    await expect(iterator.return?.()).resolves.toMatchObject({ done: true })
    expect(stream.destroyed).toBe(true)
  })
})
