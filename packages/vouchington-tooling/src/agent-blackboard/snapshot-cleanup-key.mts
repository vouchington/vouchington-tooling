import { randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const KEY_NAME = 'receipt-hmac-sha256.key'
const KEY_BYTES = 32
const defaults = { lstat, mkdir, open, readdir, link, unlink }
let filesystem = defaults
let temporaryDirectory = tmpdir

export function setCleanupKeyTempDirectoryForTest(directory = tmpdir): void {
  temporaryDirectory = directory
}
export function setCleanupKeyFilesystemForTest(overrides?: Partial<typeof defaults>): void {
  filesystem = { ...defaults, ...overrides }
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
function assertKey(info: Awaited<ReturnType<typeof lstat>>, uid: number, links = 1): void {
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.nlink !== links ||
    info.uid !== uid ||
    (Number(info.mode) & 0o777) !== 0o600
  )
    throw new Error('snapshot cleanup key is not an owner-only regular file')
}
async function keyPath(): Promise<{ path: string; uid: number }> {
  const uid = euid()
  const directory = join(temporaryDirectory(), `agent-blackboard-cleanup-${uid}`)
  try {
    await filesystem.mkdir(directory, { mode: 0o700 })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  assertDirectory(await filesystem.lstat(directory), uid)
  return { path: join(directory, KEY_NAME), uid }
}
async function readKey(path: string, uid: number): Promise<Buffer> {
  try {
    return await readPresentKey(path, uid)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return readPresentKey(path, uid)
  }
}
async function readPresentKey(path: string, uid: number): Promise<Buffer> {
  let before = await filesystem.lstat(path)
  if (before.nlink === 2) {
    assertKey(before, uid, 2)
    const candidates = (await filesystem.readdir(dirname(path))).filter((name) =>
      new RegExp(`^\\.${KEY_NAME.replaceAll('.', '\\.')}\\.[0-9a-f-]{36}$`).test(name),
    )
    const linked = await Promise.all(
      candidates.map(async (name) => ({
        name,
        info: await filesystem.lstat(join(dirname(path), name)),
      })),
    )
    const matches = linked.filter(({ info }) => info.dev === before.dev && info.ino === before.ino)
    if (matches.length !== 1) throw new Error('snapshot cleanup key has an unsafe temporary link')
    const temporary = join(dirname(path), matches[0]!.name)
    const staged = matches[0]!.info
    assertKey(staged, uid, 2)
    await filesystem.unlink(temporary)
    before = await filesystem.lstat(path)
  }
  assertKey(before, uid)
  const file = await filesystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
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
async function publishKey(path: string, uid: number): Promise<void> {
  const temporary = join(dirname(path), `.${KEY_NAME}.${randomUUID()}`)
  const file = await filesystem.open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await file.writeFile(randomBytes(KEY_BYTES))
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    await filesystem.link(temporary, path)
  } finally {
    await filesystem.unlink(temporary).catch(() => undefined)
  }
  await readKey(path, uid)
}
export async function loadCleanupSigningKey(): Promise<Buffer> {
  const { path, uid } = await keyPath()
  try {
    return await readKey(path, uid)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await publishKey(path, uid)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return readKey(path, uid)
}
