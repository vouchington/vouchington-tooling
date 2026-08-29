import { createHash } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'

const CHUNK_SIZE = 64 * 1024
export async function writeAll(file: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(bytes, offset)
    if (bytesWritten === 0) throw new Error('could not write snapshot partition')
    offset += bytesWritten
  }
}
export async function* readLines(
  file: FileHandle,
  hash?: ReturnType<typeof createHash>,
  onRead?: (bytes: number) => void,
): AsyncGenerator<string> {
  const buffer = Buffer.allocUnsafe(CHUNK_SIZE)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = ''
  let position = 0
  for (;;) {
    const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, position)
    if (!bytesRead) break
    position += bytesRead
    const bytes = buffer.subarray(0, bytesRead)
    hash?.update(bytes)
    onRead?.(bytesRead)
    pending += decoder.decode(bytes, { stream: true })
    for (;;) {
      const newline = pending.indexOf('\n')
      if (newline < 0) break
      yield pending.slice(0, newline)
      pending = pending.slice(newline + 1)
    }
  }
  pending += decoder.decode()
  if (pending) yield pending
}
