import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'

export function temporaryPath(target: string): string {
  return join(dirname(target), `.${basename(target)}.fetch-${randomUUID()}`)
}

export async function prepareStagedFile(
  root: string,
  destination: string,
  realpathPath: (path: string) => Promise<string> = realpath,
): Promise<string> {
  const absolute = join(root, destination)
  const parent = dirname(absolute)
  const relativeParent = relative(root, parent)
  let current = root
  for (const component of relativeParent.split(sep).filter(Boolean)) {
    current = join(current, component)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new Error(`symbolic link in bundle: ${destination}`)
      if (!stat.isDirectory()) throw new Error(`non-directory bundle parent: ${destination}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }
  await mkdir(parent, { recursive: true })
  const [realRoot, realParent] = await Promise.all([realpathPath(root), realpathPath(parent)])
  const child = relative(realRoot, realParent)
  if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`))
    throw new Error(`symbolic link in bundle: ${destination}`)
  return absolute
}
