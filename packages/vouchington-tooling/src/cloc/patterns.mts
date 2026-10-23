import path from 'node:path'
import picomatch from 'picomatch'

export function normalizePath(filePath: string): string {
  return filePath.replaceAll(path.sep, '/').replace(/^\.\//u, '')
}

/**
 * Compiles path patterns into one predicate over repository-relative POSIX paths.
 *
 * - No `/` (`*.test.*`, `package.json`): matched against the basename, anywhere in the tree.
 * - Trailing `/` (`docs/`) or a `/` with no glob characters (`docs/api`): the path itself or
 *   anything under it.
 * - A `/` with glob characters (`**` + `/tests/**`): a full-path glob. Dotfiles match.
 */
export function compilePatterns(patterns: readonly string[]): (filePath: string) => boolean {
  const matchers = patterns.map((pattern): ((filePath: string) => boolean) => {
    if (!pattern.includes('/')) return picomatch(pattern, { basename: true, dot: true })
    if (picomatch.scan(pattern).isGlob) {
      return picomatch(pattern.endsWith('/') ? `${pattern}**` : pattern, { dot: true })
    }
    const prefix = pattern.replace(/\/+$/u, '')
    return (filePath) => filePath === prefix || filePath.startsWith(`${prefix}/`)
  })
  return (filePath) => matchers.some((matches) => matches(filePath))
}
