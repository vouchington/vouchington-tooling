import { open } from 'node:fs/promises'

export const MAX_CONFIG_BYTES = 256 * 1024

export async function readRepositoryPathFetchConfig(
  path: string,
  openFile: typeof open = open,
): Promise<string> {
  const file = await openFile(path, 'r')
  try {
    const before = await file.stat()
    if (!before.isFile()) throw new Error('config must be a regular file')
    if (before.size > MAX_CONFIG_BYTES) throw new Error('config exceeds size limit')
    const buffer = Buffer.alloc(before.size)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) throw new Error('config changed while reading')
      offset += bytesRead
    }
    const after = await file.stat()
    if (after.size !== before.size) throw new Error('config changed while reading')
    return buffer.toString('utf8')
  } finally {
    await file.close()
  }
}
