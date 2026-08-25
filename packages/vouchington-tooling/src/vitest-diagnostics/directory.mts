import { lstatSync, opendirSync } from 'node:fs'

export const HARD_MAX_DIAGNOSTIC_DIRECTORY_ENTRIES = 10_000

interface DirectoryIdentity {
  dev: number
  ino: number
}

export interface DiagnosticReportDirectory {
  filenames: string[]
  identity: DirectoryIdentity
}

function directoryIdentity(directory: string): DirectoryIdentity | undefined {
  const stats = lstatSync(directory)
  return stats.isDirectory() ? { dev: stats.dev, ino: stats.ino } : undefined
}

export function isDiagnosticReportDirectoryCurrent(
  directory: string,
  identity: DirectoryIdentity,
): boolean {
  try {
    const current = directoryIdentity(directory)
    return current?.dev === identity.dev && current.ino === identity.ino
  } catch {
    return false
  }
}

export function readDiagnosticReportDirectory(
  directory: string,
): DiagnosticReportDirectory | undefined {
  try {
    const identity = directoryIdentity(directory)
    if (identity === undefined) return undefined
    const filenames: string[] = []
    const handle = opendirSync(directory)
    try {
      for (let scanned = 0; ; scanned += 1) {
        const entry = handle.readSync()
        if (entry === null) break
        if (scanned >= HARD_MAX_DIAGNOSTIC_DIRECTORY_ENTRIES) return undefined
        if (entry.name.endsWith('.json')) filenames.push(entry.name)
      }
    } finally {
      handle.closeSync()
    }
    if (!isDiagnosticReportDirectoryCurrent(directory, identity)) return undefined
    return { filenames, identity }
  } catch {
    return undefined
  }
}
