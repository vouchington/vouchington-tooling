import { createReadStream } from 'node:fs'

export const DEFAULT_MAX_RECORD_BYTES = 2 * 1024 * 1024

export type OpenTranscriptLinesOptions = {
  /** Largest allowed record (one line, excluding its newline) in bytes. Defaults to 2 MiB. */
  maxRecordBytes?: number
}

export type OpenTranscriptLinesResult = { lines: AsyncIterable<string> } | { error: string }

/**
 * Opens a transcript for streaming, one line at a time, with `String.split('\n')`
 * semantics (a trailing newline yields a final empty line, `\r` is preserved).
 *
 * A `maxRecordBytes` that is not a non-negative safe integer rejects with `RangeError`.
 * An open failure resolves to `{ error }`. An oversized record is NOT skipped or
 * reported inline: the returned async iterable throws
 * `transcript record exceeds <maxRecordBytes> byte limit` when it reaches the
 * record, ending iteration, and the underlying stream is destroyed. Lines yielded
 * before the oversized record remain valid.
 */
export async function openTranscriptLines(
  path: string,
  { maxRecordBytes = DEFAULT_MAX_RECORD_BYTES }: OpenTranscriptLinesOptions = {},
): Promise<OpenTranscriptLinesResult> {
  if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 0)
    throw new RangeError('maxRecordBytes must be a non-negative integer')
  const stream = createReadStream(path)
  try {
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve())
      stream.once('error', reject)
    })
    const lines = streamTranscriptLines(stream, maxRecordBytes)
    const release = lines.return.bind(lines)
    // The file is already open, so cancelling before the first next() must still close it;
    // an unstarted generator never reaches its own finally block.
    lines.return = (value) => {
      stream.destroy()
      return release(value)
    }
    return { lines }
  } catch (err) {
    stream.destroy()
    return { error: (err as Error).message }
  }
}

async function* streamTranscriptLines(
  stream: ReturnType<typeof createReadStream>,
  maxRecordBytes: number,
): AsyncGenerator<string> {
  const pending: Buffer[] = []
  let pendingBytes = 0
  const tooLarge = (): Error => new Error(`transcript record exceeds ${maxRecordBytes} byte limit`)
  const line = (tail?: Buffer): string => {
    const bytes = pendingBytes + (tail?.byteLength ?? 0)
    if (bytes > maxRecordBytes) throw tooLarge()
    const value = Buffer.concat(tail ? [...pending, tail] : pending, bytes).toString('utf8')
    pending.length = 0
    pendingBytes = 0
    return value
  }
  try {
    for await (const chunk of stream) {
      let start = 0
      for (;;) {
        const newline = chunk.indexOf(10, start)
        if (newline === -1) break
        yield line(chunk.subarray(start, newline))
        start = newline + 1
      }
      if (start < chunk.byteLength) {
        const tail = chunk.subarray(start)
        pendingBytes += tail.byteLength
        if (pendingBytes > maxRecordBytes) throw tooLarge()
        pending.push(tail)
      }
    }
    yield line()
  } finally {
    stream.destroy()
  }
}
