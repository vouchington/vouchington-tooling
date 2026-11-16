import { closeSync, constants, fsyncSync, openSync, renameSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { writeAll } from '../private-files/log-file.mts'

/** Writes one outbox file durably: a private temporary file, fsync, then an atomic rename. */
export function writeOutboxFile(directory: string, name: string, value: object): void {
  const temporary = join(directory, `.persist-${randomUUID()}`)
  const descriptor = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    writeAll(descriptor, JSON.stringify(value))
    fsyncSync(descriptor)
    closeSync(descriptor)
    renameSync(temporary, join(directory, name))
  } catch (error) {
    try {
      closeSync(descriptor)
    } catch {}
    try {
      unlinkSync(temporary)
    } catch {}
    throw error
  }
}
