import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, open, rename } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import {
  countsFor,
  manifestFor,
  snapshotLine,
  type SnapshotBlock,
} from './snapshot-partition-format.mts'
import { readLines, writeAll } from './snapshot-partition-io.mts'
import type { SnapshotManifest, SnapshotPartition } from './snapshot-types.mts'

async function copyBlock(
  block: SnapshotBlock,
  output: FileHandle,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const input = await open(block.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    for (;;) {
      const { bytesRead } = await input.read(buffer)
      if (!bytesRead) return
      const bytes = buffer.subarray(0, bytesRead)
      hash.update(bytes)
      await writeAll(output, bytes)
    }
  } finally {
    await input.close()
  }
}
export async function writePartitions(
  index: string,
  manifest: SnapshotManifest,
  directory: string,
  maxSessions: number,
  maxBytes: number,
): Promise<SnapshotPartition[]> {
  const partitions: SnapshotPartition[] = []
  const indexFile = await open(index, constants.O_RDONLY | constants.O_NOFOLLOW)
  let active:
    | {
        block: SnapshotBlock
        file: FileHandle
        temporary: string
        hash: ReturnType<typeof createHash>
      }
    | undefined
  const start = async (): Promise<NonNullable<typeof active>> => {
    const number = partitions.length + 1
    const temporary = join(directory, `.partition-${number}.tmp`)
    active = {
      block: { sessionId: '', path: '', bytes: 0, sessions: 0, entries: 0 },
      file: await open(temporary, 'wx', 0o600),
      temporary,
      hash: createHash('sha256'),
    }
    return active
  }
  const finish = async (): Promise<void> => {
    if (!active) return
    const partitionManifest = manifestFor(manifest, active.block)
    const terminal = Buffer.from(snapshotLine({ type: 'manifest', manifest: partitionManifest }))
    await writeAll(active.file, terminal)
    active.hash.update(terminal)
    await active.file.sync()
    await active.file.close()
    await chmod(active.temporary, 0o400)
    const path = join(directory, `partition-${partitions.length + 1}.jsonl`)
    await rename(active.temporary, path)
    const bytes = active.block.bytes + terminal.byteLength
    partitions.push({
      path,
      counts: countsFor(active.block, bytes),
      checksum: { algorithm: 'sha256', value: active.hash.digest('hex') },
      manifest: partitionManifest,
    })
    active = undefined
  }
  try {
    for await (const sourceLine of readLines(indexFile)) {
      const block = JSON.parse(sourceLine) as SnapshotBlock
      if (active && active.block.sessions + block.sessions > maxSessions) await finish()
      let candidate = {
        ...block,
        sessions: (active?.block.sessions ?? 0) + block.sessions,
        entries: (active?.block.entries ?? 0) + block.entries,
      }
      let terminalBytes = Buffer.byteLength(
        snapshotLine({ type: 'manifest', manifest: manifestFor(manifest, candidate) }),
      )
      if (active && active.block.bytes + block.bytes + terminalBytes > maxBytes) {
        await finish()
        candidate = { ...block }
        terminalBytes = Buffer.byteLength(
          snapshotLine({ type: 'manifest', manifest: manifestFor(manifest, candidate) }),
        )
      }
      if (block.bytes + terminalBytes > maxBytes)
        throw new Error(`snapshot session ${block.sessionId} is too large for one partition`)
      const target = active ?? (await start())
      target.block.sessions += block.sessions
      target.block.entries += block.entries
      target.block.bytes += block.bytes
      await copyBlock(block, target.file, target.hash)
    }
    await finish()
    return partitions
  } finally {
    await indexFile.close()
    await active?.file.close().catch(() => undefined)
  }
}
