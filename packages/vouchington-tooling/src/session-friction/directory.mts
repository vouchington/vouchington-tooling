import { chmodSync, lstatSync, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const PRIVATE_DIRECTORY_MODE = 0o700

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

function directoryChain(directory: string): string[] {
  const chain = [directory]
  let current = directory
  while (dirname(current) !== current) {
    current = dirname(current)
    chain.unshift(current)
  }
  return chain
}

export function ensurePrivateDirectory(directory: string, create: boolean): boolean {
  const chain = directoryChain(directory)
  for (const [index, path] of chain.entries()) {
    let created = false
    let status
    try {
      status = lstatSync(path)
    } catch (error) {
      /* v8 ignore next -- unexpected filesystem errors are propagated unchanged. */
      if (!isCode(error, 'ENOENT')) throw error
      if (!create) return false
      try {
        mkdirSync(path, { mode: PRIVATE_DIRECTORY_MODE })
        created = true
      } catch (mkdirError) {
        /* v8 ignore next -- another process can create the directory after lstat. */
        if (!isCode(mkdirError, 'EEXIST')) throw mkdirError
      }
      status = lstatSync(path)
    }
    const leaf = index === chain.length - 1
    if (status.isSymbolicLink()) {
      if (leaf || status.uid !== 0 || !statSync(path).isDirectory())
        throw new Error('session-friction log directory must be a private directory')
      /* v8 ignore next -- root-owned ancestor symlinks are platform-specific. */
      continue
    }
    if (!status.isDirectory())
      throw new Error('session-friction log directory must be a private directory')
    if (created) chmodSync(path, PRIVATE_DIRECTORY_MODE)
    const effectiveUserId = process.geteuid?.()
    /* v8 ignore next -- foreign ownership requires another OS user. */
    if (
      !created &&
      leaf &&
      ((status.mode & 0o777) !== PRIVATE_DIRECTORY_MODE ||
        (effectiveUserId !== undefined && status.uid !== effectiveUserId))
    )
      throw new Error('session-friction log directory must be a private directory')
  }
  return true
}
