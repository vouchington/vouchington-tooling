import { realpathSync, statSync } from 'node:fs'
import * as nativePath from 'node:path'

interface PathOperations {
  basename(path: string): string
  dirname(path: string): string
  join(...paths: string[]): string
}

export function canonicalizeNearestExistingPath(
  value: string,
  resolvePath: (path: string) => string = realpathSync.native,
  operations: PathOperations = nativePath,
  isCaseInsensitive: (path: string) => boolean = isCaseInsensitivePath,
): string {
  const missing: string[] = []
  let current = value
  while (true) {
    try {
      const existing = resolvePath(current)
      const identitySuffix = isCaseInsensitive(existing)
        ? missing.map((component) => component.toLowerCase())
        : missing
      return operations.join(existing, ...identitySuffix)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = operations.dirname(current)
      if (parent === current) throw error
      missing.unshift(operations.basename(current))
      current = parent
    }
  }
}

export function isCaseInsensitivePath(
  path: string,
  statPath: (path: string) => { dev: bigint; ino: bigint } = (candidate) =>
    statSync(candidate, { bigint: true }),
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === 'win32') return true
  const identity = statPath(path)
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const character = path[index]!
    if (!/[A-Za-z]/.test(character)) continue
    const toggledCharacter =
      character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase()
    const toggled = `${path.slice(0, index)}${toggledCharacter}${path.slice(index + 1)}`
    try {
      const toggledIdentity = statPath(toggled)
      return toggledIdentity.dev === identity.dev && toggledIdentity.ino === identity.ino
    } catch {
      return false
    }
  }
  return false
}
