import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import {
  consumeSnapshotRecord,
  assertManifest,
  parseSnapshotRecord,
} from './snapshot-partition-format.mts'
import { readLines } from './snapshot-partition-io.mts'
import type { SnapshotChecksum } from './snapshot-types.mts'

export function assertPartitionFile(info: Stats): void {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o222) !== 0)
    throw new Error('partition directory contains an unsafe partition')
}

export async function validatePartition(
  path: string,
  expected: Stats,
  checksum?: SnapshotChecksum,
): Promise<void> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const actual = await file.stat()
    assertPartitionFile(actual)
    if (actual.dev !== expected.dev || actual.ino !== expected.ino)
      throw new Error('partition directory changed while it was being removed')
    const state = { sessions: 0, entries: 0, records: 0 }
    const hash = createHash('sha256')
    let manifest = false
    for await (const line of readLines(file, hash)) {
      if (!line || manifest) throw new Error('partition contains invalid JSONL')
      const record = parseSnapshotRecord(line)
      if (record.type === 'manifest') {
        assertManifest(record.manifest, state)
        manifest = true
      } else {
        consumeSnapshotRecord(record, state)
      }
    }
    if (!manifest || state.sessions === 0)
      throw new Error('partition is missing a complete terminal manifest')
    if (checksum && hash.digest('hex') !== checksum.value)
      throw new Error('partition checksum does not match cleanup receipt')
  } finally {
    await file.close()
  }
}
