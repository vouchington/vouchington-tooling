// Each fork writes start and exit records to its own `<pid>.jsonl` file. A start without an exit
// identifies a death before the sentinel handler ran. Synchronous writes avoid async pipe loss.
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { sanitizeInlineErrorMessage } from './vitest-fork-exit-error-detail.mts'

export type ForkExitRecordMode = 'exit' | 'uncaught' | 'unhandled' | `signal:${NodeJS.Signals}`

export type ForkExitSentinelRecord =
  | { kind: 'start'; pid: number }
  | {
      kind: 'exit'
      pid: number
      project: string
      module: string
      mode: ForkExitRecordMode
      code: number
      // Populated only for mode 'uncaught'/'unhandled' — see vitest-fork-exit-error-detail.mts.
      errorMessage?: string
      errorStack?: string
    }

const recordFileFds = new Map<string, number>()

function recordFileDescriptor(directory: string): number | null {
  const cached = recordFileFds.get(directory)
  if (cached !== undefined) return cached
  try {
    mkdirSync(directory, { recursive: true })
    if (!lstatSync(directory).isDirectory()) return null
    const fd = openSync(
      join(directory, `${process.pid}.jsonl`),
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
      0o600,
    )
    recordFileFds.set(directory, fd)
    return fd
  } catch {
    // Best-effort: a read-only or missing directory must not turn attribution into a crash. The
    // fd-2 [vitest-fork-exit] line stays the primary signal; this file is a durable supplement.
    return null
  }
}

export function writeForkExitRecord(directory: string, record: ForkExitSentinelRecord): void {
  const fd = recordFileDescriptor(directory)
  if (fd === null) return
  try {
    writeSync(fd, `${JSON.stringify(record)}\n`)
  } catch {
    // Same best-effort rationale as recordFileDescriptor() above.
  }
}

export function readForkExitRecords(dir: string): ForkExitSentinelRecord[] {
  const records: ForkExitSentinelRecord[] = []
  for (const filename of recordFileNames(dir)) {
    parseRecordLines(readFileSafely(join(dir, filename)), records)
  }
  return records
}

export function clearForkExitRecords(dir: string): void {
  const fd = recordFileFds.get(dir)
  if (fd !== undefined) {
    closeSync(fd)
    recordFileFds.delete(dir)
  }
  for (const filename of recordFileNames(dir)) {
    try {
      const path = join(dir, filename)
      if (lstatSync(path).isFile()) unlinkSync(path)
    } catch {
      // A concurrently exiting worker may have removed its file already.
    }
  }
}

function recordFileNames(dir: string): string[] {
  try {
    if (!lstatSync(dir).isDirectory()) return []
    return readdirSync(dir).filter((name) => /^\d+\.jsonl$/.test(name))
  } catch {
    return []
  }
}

export interface ForkExitRecordSummary {
  startedPidCount: number
  exitRecords: Extract<ForkExitSentinelRecord, { kind: 'exit' }>[]
  forksWithoutExitSentinel: number
}

export function summarizeForkExitRecords(records: ForkExitSentinelRecord[]): ForkExitRecordSummary {
  const startedPids = new Set<number>()
  const exitRecordsByPid = new Map<number, Extract<ForkExitSentinelRecord, { kind: 'exit' }>>()
  for (const record of records) {
    if (record.kind === 'start') startedPids.add(record.pid)
    else exitRecordsByPid.set(record.pid, record)
  }
  const forksWithoutExitSentinel = [...startedPids].filter(
    (pid) => !exitRecordsByPid.has(pid),
  ).length
  return {
    startedPidCount: startedPids.size,
    exitRecords: [...exitRecordsByPid.values()],
    forksWithoutExitSentinel,
  }
}

const MAX_SENTINEL_EXIT_RECORDS = 20

// Consumed by vitest-worker-exit-diagnostics-reporter.mts's onTestRunEnd — kept here rather than
// there so the record shape and its presentation stay next to each other.
export function formatForkExitSentinelSection(summary: ForkExitRecordSummary): string[] {
  const lines = [
    `forks started: ${summary.startedPidCount}`,
    `forks without an exit sentinel: ${summary.forksWithoutExitSentinel}`,
    'sentinel exit records:',
  ]
  if (summary.exitRecords.length === 0) {
    lines.push('  (none recorded)')
    return lines
  }
  for (const record of summary.exitRecords.slice(0, MAX_SENTINEL_EXIT_RECORDS)) {
    lines.push(
      `  - pid=${record.pid} project=${sanitizeInlineErrorMessage(record.project)} module=${sanitizeInlineErrorMessage(record.module)} mode=${record.mode} code=${record.code}`,
    )
    // sanitizeInlineErrorMessage collapses the record's raw, unbounded message to one line: this
    // report is written straight into a test log, so a raw multi-line Error.message could forge
    // fresh physical lines that a line-anchored log predicate reads as real output.
    if (record.errorMessage)
      lines.push(`    error: ${sanitizeInlineErrorMessage(record.errorMessage)}`)
    if (record.errorStack)
      lines.push(`    stack: ${sanitizeInlineErrorMessage(record.errorStack.slice(0, 500))}`)
  }
  if (summary.exitRecords.length > MAX_SENTINEL_EXIT_RECORDS) {
    lines.push(`  ... ${summary.exitRecords.length - MAX_SENTINEL_EXIT_RECORDS} more`)
  }
  return lines
}

function readFileSafely(path: string): string {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > 1024 * 1024) return ''
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function parseRecordLines(content: string, into: ForkExitSentinelRecord[]): void {
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const record: unknown = JSON.parse(line)
      if (isForkExitRecord(record)) into.push(record)
    } catch {
      // A torn trailing line from a fork still mid-write when this is read; skip it rather than
      // fail the whole roll-up over one partial record.
    }
  }
}

function isForkExitRecord(value: unknown): value is ForkExitSentinelRecord {
  if (!isRecord(value)) return false
  if (!Number.isSafeInteger(value.pid) || (value.pid as number) <= 0) return false
  if (value.kind === 'start') return true
  return (
    value.kind === 'exit' &&
    typeof value.project === 'string' &&
    typeof value.module === 'string' &&
    typeof value.mode === 'string' &&
    (value.mode === 'exit' ||
      value.mode === 'uncaught' ||
      value.mode === 'unhandled' ||
      /^signal:SIG[A-Z0-9]+$/.test(value.mode)) &&
    Number.isSafeInteger(value.code) &&
    (value.errorMessage === undefined || typeof value.errorMessage === 'string') &&
    (value.errorStack === undefined || typeof value.errorStack === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
