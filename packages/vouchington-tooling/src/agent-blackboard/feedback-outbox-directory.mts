import { lstatSync, mkdirSync } from 'node:fs'

/** The outbox is temporary retry state; ancestor ownership and modes do not govern it. */
export function ensureOutboxDirectory(directory: string, create: boolean): boolean {
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 })
  try {
    if (!lstatSync(directory).isDirectory())
      throw new Error(`feedback outbox must be a directory: ${directory}`)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return false
    throw error
  }
}
