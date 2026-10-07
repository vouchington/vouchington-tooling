import { isAbsolute, relative } from 'node:path'
import { posix } from 'node:path'

export type SourceGraphPaths = {
  root: string
  extensions: readonly string[]
  aliases: Readonly<Record<string, string>>
  files: ReadonlySet<string>
}

export function relativeFile(root: string, file: string): string | null {
  const value = isAbsolute(file) ? relative(root, file) : file
  const normalized = posix.normalize(value.replaceAll('\\', '/'))
  return normalized === '..' || normalized.startsWith('../') || posix.isAbsolute(normalized)
    ? null
    : normalized
}

export function resolveSourcePath(
  paths: SourceGraphPaths,
  fromFile: string,
  specifier: string,
): string | null {
  let target: string | null = null
  if (specifier.startsWith('.')) {
    target = posix.join(posix.dirname(fromFile), specifier)
  } else {
    const alias = Object.keys(paths.aliases)
      .filter((prefix) => specifier.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0]
    if (alias) target = posix.join(paths.aliases[alias] ?? '', specifier.slice(alias.length))
  }
  if (!target) return null
  const base = relativeFile(paths.root, target)
  if (!base) return null
  for (const suffix of paths.extensions) {
    const candidate = `${base}${suffix}`
    if (paths.files.has(candidate)) return candidate
  }
  for (const suffix of paths.extensions) {
    const candidate = posix.join(base, `index${suffix}`)
    if (paths.files.has(candidate)) return candidate
  }
  return paths.files.has(base) ? base : null
}
