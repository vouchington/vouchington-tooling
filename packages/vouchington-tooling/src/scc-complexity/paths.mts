import { relative, resolve } from 'node:path'

export function canonicalRepoPath(repoRoot: string, path: string): string {
  const relativePath = relative(repoRoot, resolve(repoRoot, path.replaceAll('\\', '/'))).replaceAll(
    '\\',
    '/',
  )
  return relativePath || '.'
}

export function isInsideRepo(path: string): boolean {
  return path !== '..' && !path.startsWith('../')
}

export function isInScope(file: string, includePaths: readonly string[]): boolean {
  return includePaths.some(
    (includePath) =>
      includePath === '.' || file === includePath || file.startsWith(`${includePath}/`),
  )
}
