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
  const effectiveUserId = process.geteuid?.()
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
      if (leaf || status.uid !== 0)
        throw new Error('session-friction log directory must be a private directory')
      try {
        status = statSync(path)
      } catch {
        throw new Error('session-friction log directory must be a private directory')
      }
    }
    if (!status.isDirectory())
      throw new Error('session-friction log directory must be a private directory')
    if (created) chmodSync(path, PRIVATE_DIRECTORY_MODE)
    if (!created) {
      const ownedByCaller = effectiveUserId === undefined || status.uid === effectiveUserId
      const ownedByRoot = status.uid === 0
      const writableByOthers = (status.mode & 0o022) !== 0
      const sticky = (status.mode & 0o1000) !== 0
      if (
        (leaf && ((status.mode & 0o777) !== PRIVATE_DIRECTORY_MODE || !ownedByCaller)) ||
        (!leaf && !ownedByCaller && !ownedByRoot) ||
        (!leaf && writableByOthers && !sticky)
      )
        throw new Error('session-friction log directory must be a private directory')
    }
  }
  return true
}
