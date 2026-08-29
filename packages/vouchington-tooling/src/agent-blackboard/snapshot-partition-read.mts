import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertManifest,
  consumeSnapshotRecord,
  parseSnapshotRecord,
  snapshotLine,
  type SnapshotBlock,
  type SnapshotState,
} from './snapshot-partition-format.mts'
import { readLines, writeAll } from './snapshot-partition-io.mts'
import type { SnapshotManifest } from './snapshot-types.mts'

export interface StagedSnapshot {
  manifest: SnapshotManifest
  bytes: number
  checksum: string
  index: string
}
export async function stageSnapshot(
  source: FileHandle,
  directory: string,
): Promise<StagedSnapshot> {
  const index = join(directory, 'index.jsonl')
  const indexFile = await open(index, 'wx', 0o600)
  const hash = createHash('sha256')
  const state: SnapshotState = { sessions: 0, entries: 0, records: 0 }
  let current: (SnapshotBlock & { file: FileHandle }) | undefined
  let manifest: SnapshotManifest | undefined
  let ordinal = 0
  let bytes = 0
  const finish = async (): Promise<void> => {
    if (!current) return
    await current.file.sync()
    await current.file.close()
    const { file: _file, ...block } = current
    await writeAll(indexFile, Buffer.from(snapshotLine(block)))
    current = undefined
  }
  try {
    for await (const sourceLine of readLines(source, hash, (read) => {
      bytes += read
    })) {
      if (!sourceLine) throw new Error('snapshot contains a blank JSONL record')
      if (manifest) throw new Error('snapshot contains records after its manifest')
      const record = parseSnapshotRecord(sourceLine)
      if (record.type === 'manifest') {
        await finish()
        manifest = record.manifest
        assertManifest(manifest, state)
        continue
      }
      if (record.type === 'session') {
        await finish()
        ordinal += 1
        const path = join(directory, `session-${ordinal}.jsonl`)
        current = {
          sessionId: record.session.id as string,
          path,
          bytes: 0,
          sessions: 1,
          entries: 0,
          file: await open(path, 'wx', 0o600),
        }
      } else if (!current) throw new Error('snapshot entries must follow their session')
      consumeSnapshotRecord(record, state)
      if (record.type === 'entry') current!.entries += 1
      const recordBytes = Buffer.from(`${sourceLine}\n`)
      await writeAll(current!.file, recordBytes)
      current!.bytes += recordBytes.byteLength
    }
    if (!manifest) throw new Error('snapshot is missing a complete terminal manifest')
    await indexFile.sync()
    return { manifest, bytes, checksum: hash.digest('hex'), index }
  } finally {
    await current?.file.close().catch(() => undefined)
    await indexFile.close().catch(() => undefined)
  }
}
