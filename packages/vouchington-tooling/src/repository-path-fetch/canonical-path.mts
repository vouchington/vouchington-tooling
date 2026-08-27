import { randomUUID } from 'node:crypto'
import { closeSync, lstatSync, openSync, realpathSync, unlinkSync } from 'node:fs'
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
  probeDirectory: (path: string) => boolean = probeDirectoryCaseSensitivity,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === 'win32') return true
  try {
    return probeDirectory(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error
    return probeDirectory(nativePath.dirname(path))
  }
}

export function probeDirectoryCaseSensitivity(
  directory: string,
  createProbe: (path: string) => void = (path) => closeSync(openSync(path, 'wx', 0o600)),
  identity: (path: string) => { dev: bigint; ino: bigint } = (path) =>
    lstatSync(path, { bigint: true }),
  removeProbe: (path: string) => void = unlinkSync,
  name = `.vouchington-case-${randomUUID()}`,
): boolean {
  const probe = nativePath.join(directory, name)
  const toggled = nativePath.join(directory, name.replace('v', 'V'))
  createProbe(probe)
  let original: { dev: bigint; ino: bigint } | undefined
  try {
    original = identity(probe)
    try {
      const alias = identity(toggled)
      return alias.dev === original.dev && alias.ino === original.ino
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  } finally {
    removeOwnedProbe(probe, original, identity, removeProbe)
  }
}

function removeOwnedProbe(
  probe: string,
  original: { dev: bigint; ino: bigint } | undefined,
  identity: (path: string) => { dev: bigint; ino: bigint },
  removeProbe: (path: string) => void,
): void {
  if (original === undefined) throw new Error('case probe identity unavailable during cleanup')
  const current = identity(probe)
  if (current.dev !== original.dev || current.ino !== original.ino)
    throw new Error('case probe changed before cleanup')
  removeProbe(probe)
}
