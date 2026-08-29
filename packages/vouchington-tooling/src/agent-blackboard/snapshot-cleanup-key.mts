import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const KEY_NAME = 'receipt-hmac-sha256.key'
const KEY_BYTES = 32
let temporaryDirectory = tmpdir

export function setCleanupKeyTempDirectoryForTest(directory = tmpdir): void {
  temporaryDirectory = directory
}

function euid(): number {
  if (typeof process.geteuid !== 'function')
    throw new Error('snapshot cleanup receipts require a POSIX effective user ID')
  return process.geteuid()
}
function assertDirectory(info: Awaited<ReturnType<typeof lstat>>, uid: number): void {
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    info.uid !== uid ||
    (Number(info.mode) & 0o777) !== 0o700
  )
    throw new Error('snapshot cleanup key directory is not owner-only')
}
function assertKey(info: Awaited<ReturnType<typeof lstat>>, uid: number): void {
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.nlink !== 1 ||
    info.uid !== uid ||
    (Number(info.mode) & 0o777) !== 0o600
  )
    throw new Error('snapshot cleanup key is not an owner-only regular file')
}
async function keyPath(): Promise<{ path: string; uid: number }> {
  const uid = euid()
  const directory = join(temporaryDirectory(), `agent-blackboard-cleanup-${uid}`)
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  assertDirectory(await lstat(directory), uid)
  return { path: join(directory, KEY_NAME), uid }
}
async function readKey(path: string, uid: number): Promise<Buffer> {
  const before = await lstat(path)
  assertKey(before, uid)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const after = await file.stat()
    assertKey(after, uid)
    if (after.dev !== before.dev || after.ino !== before.ino)
      throw new Error('snapshot cleanup key changed while it was opened')
    const key = await file.readFile()
    if (key.byteLength !== KEY_BYTES) throw new Error('snapshot cleanup key has an invalid length')
    return key
  } finally {
    await file.close()
  }
}

export async function loadCleanupSigningKey(): Promise<Buffer> {
  const { path, uid } = await keyPath()
  try {
    return await readKey(path, uid)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const created = randomBytes(KEY_BYTES)
  try {
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try {
      await file.writeFile(created)
      await file.sync()
    } finally {
      await file.close()
    }
    return await readKey(path, uid)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return readKey(path, uid)
  }
}
