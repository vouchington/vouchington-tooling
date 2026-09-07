import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, win32 } from 'node:path'

export function canonicalRepoPath(repoRoot: string, path: string): string {
  const relativePath = relative(repoRoot, resolve(repoRoot, path.replaceAll('\\', '/'))).replaceAll(
    '\\',
    '/',
  )
  return relativePath || '.'
}

function isInsideRepo(path: string): boolean {
  return path !== '..' && !path.startsWith('../')
}

export function isInScope(file: string, includePaths: readonly string[]): boolean {
  return includePaths.some(
    (includePath) =>
      includePath === '.' || file === includePath || file.startsWith(`${includePath}/`),
  )
}

export async function canonicalScopePath(repoRoot: string, path: string): Promise<string> {
  if (isAbsolute(path) || win32.parse(path).root) throw new Error('path is outside the repository')
  const physicalRoot = await realpath(repoRoot)
  const candidatePath = resolve(repoRoot, path.replaceAll('\\', '/'))
  if (!isInsideRepo(canonicalRepoPath(repoRoot, candidatePath)))
    throw new Error('path is outside the repository')
  const physicalPath = await physicalPathFor(candidatePath, repoRoot, physicalRoot)
  const canonicalPath = canonicalRepoPath(physicalRoot, physicalPath)
  if (!isInsideRepo(canonicalPath)) throw new Error('path is outside the repository')
  return canonicalPath
}

export function assertWorkflowCommandData(value: string, label: string): void {
  if (/[\r\n]/.test(value))
    throw new Error(`${label} contains a workflow command control character`)
}

async function physicalPathFor(
  path: string,
  repoRoot: string,
  physicalRoot: string,
): Promise<string> {
  let existingPath = path
  while (existingPath !== repoRoot) {
    try {
      const physicalPath = await realpath(existingPath)
      return resolve(physicalPath, relative(existingPath, path))
    } catch (error) {
      if ((await lstat(existingPath).catch(() => undefined))?.isSymbolicLink()) throw error
      existingPath = dirname(existingPath)
    }
  }
  return resolve(physicalRoot, relative(repoRoot, path))
}
