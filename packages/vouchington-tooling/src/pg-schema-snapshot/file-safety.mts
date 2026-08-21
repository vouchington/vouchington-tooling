import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function unsafeSchemaSnapshotPath(path: string): Error {
  return new Error(`Unsafe generated PostgreSQL schema snapshot path: ${path}`)
}

export async function lstatOrNull(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) =>
    /* v8 ignore next -- non-ENOENT stat failures are host-specific */
    error.code === 'ENOENT' ? null : Promise.reject(error),
  )
}

async function assertSafeDirectory(path: string, create: boolean): Promise<void> {
  let stats = await lstatOrNull(path)
  if (stats === null && create) {
    await mkdir(path).catch((error: NodeJS.ErrnoException) =>
      error.code === 'EEXIST' ? undefined : Promise.reject(error),
    )
    stats = await lstatOrNull(path)
  }
  if (stats === null || stats.isSymbolicLink() || !stats.isDirectory()) {
    throw unsafeSchemaSnapshotPath(path)
  }
}

function relativeSnapshotPath(root: string, path: string): string {
  const relativePath = relative(resolve(root), resolve(path))
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw unsafeSchemaSnapshotPath(path)
  }
  return relativePath
}

async function assertSafePathComponents(
  directory: string,
  components: string[],
  create: boolean,
): Promise<void> {
  const [component, ...remaining] = components
  if (component === undefined) return
  const path = join(directory, component)
  const stats = await lstatOrNull(path)
  if (stats === null && !create) return
  await assertSafeDirectory(path, create)
  await assertSafePathComponents(path, remaining, create)
}

async function assertSafeParentDirectories(
  root: string,
  path: string,
  create: boolean,
): Promise<void> {
  const resolvedRoot = resolve(root)
  const relativePath = relativeSnapshotPath(resolvedRoot, path)
  await assertSafeDirectory(resolvedRoot, false)
  await assertSafePathComponents(resolvedRoot, relativePath.split(sep).slice(0, -1), create)
}

async function assertSafeFilePath(root: string, path: string, create: boolean): Promise<void> {
  await assertSafeParentDirectories(root, path, create)
  const leaf = await lstatOrNull(path)
  if (leaf?.isSymbolicLink()) throw unsafeSchemaSnapshotPath(path)
}

export async function assertSafeExistingFilePath(root: string, path: string): Promise<void> {
  await assertSafeFilePath(root, path, false)
}

export async function ensureSafeParentDirectory(root: string, path: string): Promise<void> {
  await assertSafeFilePath(root, path, true)
}

export async function writeGeneratedFile(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  await ensureSafeParentDirectory(root, path)
  const temporaryDirectory = await mkdtemp(join(dirname(path), '.schema-snapshot-'))
  const temporaryPath = join(temporaryDirectory, 'contents')
  try {
    await writeFile(temporaryPath, content)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}
