import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, open, readFile, readdir, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sameCleanupReceipt, verifyCleanupReceipt } from './snapshot-cleanup-receipt.mts'
import type { SnapshotCleanupReceipt } from './snapshot-types.mts'

const defaults = { link, lstat, open, readFile, readdir, rm, unlink }
let filesystem = defaults

export function setResumeFilesystemForTest(overrides?: Partial<typeof defaults>): void {
  filesystem = { ...defaults, ...overrides }
}

function pathFor(receipt: SnapshotCleanupReceipt): string {
  if (!/^[0-9a-f-]{36}$/.test(receipt.token))
    throw new Error('partition directory cleanup receipt has an invalid token')
  return join(tmpdir(), `.agent-blackboard-cleanup-${receipt.token}.resume.json`)
}
function temporaryPath(receipt: SnapshotCleanupReceipt): string {
  return `${pathFor(receipt)}.${randomUUID()}.tmp`
}
function assertResumeFile(info: Awaited<ReturnType<typeof lstat>>, links = 1): void {
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.nlink !== links ||
    (Number(info.mode) & 0o777) !== 0o400 ||
    (typeof process.geteuid === 'function' && info.uid !== process.geteuid())
  )
    throw new Error('partition directory cleanup resume metadata is unsafe')
}
async function read(receipt: SnapshotCleanupReceipt): Promise<void> {
  const path = pathFor(receipt)
  let before = await filesystem.lstat(path)
  if (before.nlink === 2) {
    assertResumeFile(before, 2)
    const candidates = (await filesystem.readdir(tmpdir())).filter((name) =>
      new RegExp(
        `^${path.split('/').at(-1)!.replaceAll('.', '\\.')}(?:\\.[0-9a-f-]{36}\\.tmp)$`,
      ).test(name),
    )
    const linked = await Promise.all(
      candidates.map(async (name) => ({
        name,
        info: await filesystem.lstat(join(tmpdir(), name)),
      })),
    )
    const matches = linked.filter(({ info }) => info.dev === before.dev && info.ino === before.ino)
    if (matches.length !== 1)
      throw new Error('partition directory cleanup resume metadata is unsafe')
    const temporary = join(tmpdir(), matches[0]!.name)
    const staged = matches[0]!.info
    assertResumeFile(staged, 2)
    await filesystem.unlink(temporary)
    before = await filesystem.lstat(path)
  }
  assertResumeFile(before)
  const contents = await filesystem.readFile(path, 'utf8')
  const after = await filesystem.lstat(path)
  assertResumeFile(after)
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new Error('partition directory cleanup resume metadata does not match receipt')
  }
  if (before.dev !== after.dev || before.ino !== after.ino || !sameCleanupReceipt(parsed, receipt))
    throw new Error('partition directory cleanup resume metadata does not match receipt')
  await verifyCleanupReceipt(receipt)
}
export async function writeResumeReceipt(receipt: SnapshotCleanupReceipt): Promise<void> {
  const path = pathFor(receipt)
  const temporary = temporaryPath(receipt)
  let file
  try {
    file = await filesystem.open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o400,
    )
    const { serializeCleanupReceipt } = await import('./snapshot-cleanup-receipt.mts')
    await file.writeFile(serializeCleanupReceipt(receipt))
    await file.sync()
    await file.close()
    file = undefined
    await filesystem.link(temporary, path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    await file?.close()
    await filesystem.unlink(temporary).catch(() => undefined)
  }
  await read(receipt)
}
export async function removeResumeReceipt(receipt: SnapshotCleanupReceipt): Promise<void> {
  try {
    await read(receipt)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await filesystem.rm(pathFor(receipt), { force: false })
}
export async function requireResumeReceipt(receipt: SnapshotCleanupReceipt): Promise<void> {
  await read(receipt)
}
