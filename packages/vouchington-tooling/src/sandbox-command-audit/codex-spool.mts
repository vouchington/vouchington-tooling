import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'

export type Spool = {
  path: string
  /** Appends one line; rejects once the byte limit is passed or the stream has failed. */
  write: (line: string) => Promise<void>
  /** Flushes and closes the file, keeping it on disk for a replay. */
  close: () => Promise<void>
  /** Closes the stream if open and deletes the spool directory. */
  discard: () => Promise<void>
}

function assertHealthy(writer: WriteStream): void {
  if (writer.errored) throw writer.errored
}

/**
 * A temporary line spool for the history a forked Codex child inherits before its first owned
 * task. It lives under `tempRoot` so a large inherited prefix never sits in memory.
 */
export async function createSpool(tempRoot: string, limitBytes: number): Promise<Spool> {
  const dir = await mkdtemp(join(tempRoot, 'sandbox-audit-codex-'))
  const path = join(dir, 'inherited.jsonl')
  const writer = createWriteStream(path, { encoding: 'utf8' })
  let bytes = 0
  let closed = false
  // An open failure surfaces from the first write or from close, through the stream's error.
  writer.on('error', () => undefined)
  return {
    path,
    async write(line) {
      assertHealthy(writer)
      bytes += Buffer.byteLength(line) + 1
      if (bytes > limitBytes) {
        throw new Error(`inherited Codex spool exceeds ${limitBytes} byte limit`)
      }
      if (!writer.write(`${line}\n`)) await once(writer, 'drain')
    },
    async close() {
      assertHealthy(writer)
      writer.end()
      await finished(writer)
      closed = true
      assertHealthy(writer)
    },
    async discard() {
      if (!closed) writer.destroy()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
