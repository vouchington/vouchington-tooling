import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'

export const MAX_DIAGNOSTIC_REPORT_BYTES = 5 * 1024 * 1024

export function readBoundedRegularFile(path: string): string | undefined {
  const entryStats = lstatSync(path)
  if (!entryStats.isFile() || entryStats.isSymbolicLink()) return undefined
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  )
  try {
    const stats = fstatSync(descriptor)
    const currentEntryStats = lstatSync(path)
    if (
      !stats.isFile() ||
      currentEntryStats.isSymbolicLink() ||
      !currentEntryStats.isFile() ||
      currentEntryStats.dev !== stats.dev ||
      currentEntryStats.ino !== stats.ino ||
      stats.size > MAX_DIAGNOSTIC_REPORT_BYTES
    )
      return undefined
    const chunks: Buffer[] = []
    let length = 0
    while (length <= MAX_DIAGNOSTIC_REPORT_BYTES) {
      const remaining = MAX_DIAGNOSTIC_REPORT_BYTES + 1 - length
      const expected =
        length < stats.size ? stats.size - length : length === stats.size ? 1 : 65_536
      const bytes = Buffer.allocUnsafe(Math.min(expected, remaining, 65_536))
      const read = readSync(descriptor, bytes, 0, bytes.length, null)
      if (read === 0) break
      chunks.push(bytes.subarray(0, read))
      length += read
    }
    return length > MAX_DIAGNOSTIC_REPORT_BYTES
      ? undefined
      : Buffer.concat(chunks, length).toString('utf8')
  } finally {
    closeSync(descriptor)
  }
}
