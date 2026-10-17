import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { openTranscriptLines } from './transcript-lines.mts'

const testDirs: string[] = []

async function fileWith(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'transcript-lines-'))
  testDirs.push(dir)
  const path = join(dir, 'transcript.jsonl')
  await writeFile(path, content, 'utf8')
  return path
}

async function collect(path: string, maxRecordBytes?: number): Promise<string[]> {
  const opened = await openTranscriptLines(
    path,
    maxRecordBytes === undefined ? {} : { maxRecordBytes },
  )
  if ('error' in opened) throw new Error(opened.error)
  const lines: string[] = []
  for await (const line of opened.lines) lines.push(line)
  return lines
}

describe('openTranscriptLines', () => {
  afterEach(async () => {
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('yields multi-chunk lines incrementally', async () => {
    const path = await fileWith(`${'x'.repeat(80 * 1024)}\n{"after":"chunk"}\n`)
    const opened = await openTranscriptLines(path)
    if ('error' in opened) throw new Error(opened.error)
    const iterator = opened.lines[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: 'x'.repeat(80 * 1024) })
    await expect(iterator.next()).resolves.toMatchObject({ value: '{"after":"chunk"}' })
    await iterator.return?.()
  })

  it('preserves String.split newline semantics', async () => {
    expect(await collect(await fileWith(''))).toEqual([''])
    expect(await collect(await fileWith('one\r\ntwo\n'))).toEqual(['one\r', 'two', ''])
  })

  it('returns a read error for a missing path', async () => {
    const path = await fileWith('')
    expect(await openTranscriptLines(`${path}.missing`)).toMatchObject({
      error: expect.any(String),
    })
  })

  it('throws for a newline-free record over the default 2 MiB limit', async () => {
    const path = await fileWith('x'.repeat(2 * 1024 * 1024 + 1))
    await expect(collect(path)).rejects.toThrow('transcript record exceeds 2097152 byte limit')
  })

  it('accepts a record exactly at the default limit', async () => {
    const record = 'x'.repeat(2 * 1024 * 1024)
    expect(await collect(await fileWith(`${record}\n`))).toEqual([record, ''])
  })

  it('honors a custom limit and keeps lines yielded before the oversized record', async () => {
    const path = await fileWith('ok\ntoo-long\n')
    const opened = await openTranscriptLines(path, { maxRecordBytes: 5 })
    if ('error' in opened) throw new Error(opened.error)
    const iterator = opened.lines[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: 'ok' })
    await expect(iterator.next()).rejects.toThrow('transcript record exceeds 5 byte limit')
  })

  it('rejects an invalid record limit before opening the file', async () => {
    const path = await fileWith('x')
    for (const limit of [Number.NaN, -1, 1.5, Infinity])
      await expect(openTranscriptLines(path, { maxRecordBytes: limit })).rejects.toThrow(RangeError)
  })

  it('rejects an oversized record that ends in a newline within one chunk', async () => {
    await expect(collect(await fileWith('abcdef\n'), 5)).rejects.toThrow('exceeds 5 byte limit')
  })

  it('rejects an oversized final record without a newline', async () => {
    await expect(collect(await fileWith('ab\ncdefgh'), 5)).rejects.toThrow('exceeds 5 byte limit')
  })
})
