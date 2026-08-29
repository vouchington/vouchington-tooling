import { execFile } from 'node:child_process'
import { lstat, mkdir } from 'node:fs/promises'
import { parse, relative, resolve, sep, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type TargetDirectory = { path: string; dev: bigint; ino: bigint }

export async function resolveTargetDirectory(targetRoot: string): Promise<TargetDirectory> {
  const path = resolve(targetRoot)
  await assertNoSymlinkAncestors(path)
  await mkdir(path, { recursive: true })
  await assertNoSymlinkAncestors(path)
  return snapshotTargetDirectory(path)
}

export async function linkDirectoryEntry(
  source: string,
  target: TargetDirectory,
  name: string,
  beforeWorker?: () => Promise<void>,
  worker: DirectoryLinkWorker = runDirectoryLinkWorker,
  afterWorker?: () => Promise<void>,
): Promise<boolean> {
  await beforeWorker?.()
  const stdout = await worker(source, target, name)
  await afterWorker?.()
  await assertTargetUnchanged(target)
  if (stdout === 'created') return true
  if (stdout === 'existing') return false
  throw new Error('Skill link worker returned an invalid result')
}

type DirectoryLinkWorker = (
  source: string,
  target: TargetDirectory,
  name: string,
) => Promise<string>

async function runDirectoryLinkWorker(
  source: string,
  target: TargetDirectory,
  name: string,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        LINK_WORKER,
        source,
        name,
        String(target.dev),
        String(target.ino),
      ],
      { cwd: target.path, windowsHide: true },
    )
    return stdout
  } catch (error) {
    if ((error as { stderr?: string }).stderr?.includes('Target root changed during skill linking'))
      throw new Error('Target root changed during skill linking')
    throw error
  }
}

export async function snapshotTargetDirectory(path: string): Promise<TargetDirectory> {
  const stat = await lstat(path, { bigint: true })
  if (stat.isSymbolicLink()) throw new Error(`Target root contains symlink: ${path}`)
  if (!stat.isDirectory()) throw new Error(`Invalid target root: ${path}`)
  return { path, dev: stat.dev, ino: stat.ino }
}

async function assertTargetUnchanged(target: TargetDirectory): Promise<void> {
  try {
    const current = await snapshotTargetDirectory(target.path)
    if (current.dev === target.dev && current.ino === target.ino) return
  } catch {}
  throw new Error('Target root changed during skill linking')
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
  const parsed = parse(path)
  let ancestor = parsed.root
  for (const component of relative(parsed.root, path).split(sep)) {
    ancestor = join(ancestor, component)
    try {
      const stat = await lstat(ancestor)
      if (stat.isSymbolicLink()) throw new Error(`Target root contains symlink: ${ancestor}`)
      if (!stat.isDirectory()) throw new Error(`Invalid target root: ${ancestor}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

const LINK_WORKER = String.raw`
import { lstat, realpath, symlink } from 'node:fs/promises'

const [source, name, dev, ino] = process.argv.slice(1)
const directory = await lstat('.', { bigint: true })
if (!directory.isDirectory() || directory.isSymbolicLink() || directory.dev !== BigInt(dev) || directory.ino !== BigInt(ino))
  throw new Error('Target root changed during skill linking')
try {
  const destination = await lstat(name)
  if (!destination.isSymbolicLink() || (await realpath(name)) !== source)
    throw new Error('Destination already exists: ' + name)
  process.stdout.write('existing')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
  try {
    await symlink(source, name, 'dir')
  } catch (error) {
    if (process.platform !== 'win32' || !['EACCES', 'EPERM'].includes(error?.code)) throw error
    await symlink(source, name, 'junction')
  }
  process.stdout.write('created')
}
`
