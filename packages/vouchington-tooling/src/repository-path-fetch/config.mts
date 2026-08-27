import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

export const MAX_CONFIG_BYTES = 256 * 1024

export async function readRepositoryPathFetchConfig(
  path: string,
  openFile: typeof open = open,
  lstatFile: typeof lstat = lstat,
): Promise<string> {
  const pathStat = await lstatFile(path)
  if (pathStat.isSymbolicLink()) throw new Error('config must not be a symbolic link')
  if (!pathStat.isFile()) throw new Error('config must be a regular file')
  const flags =
    process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW
  const file = await openFile(path, flags)
  try {
    const before = await file.stat()
    if (!before.isFile()) throw new Error('config must be a regular file')
    if (before.dev !== pathStat.dev || before.ino !== pathStat.ino)
      throw new Error('config changed while opening')
    const afterOpen = await lstatFile(path)
    if (
      afterOpen.isSymbolicLink() ||
      !afterOpen.isFile() ||
      afterOpen.dev !== before.dev ||
      afterOpen.ino !== before.ino
    )
      throw new Error('config changed while opening')
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
