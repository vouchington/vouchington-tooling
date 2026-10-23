import { appendFileSync, writeSync } from 'node:fs'
import type { Reporter, TestModule } from 'vitest/node'

export const DEFAULT_FILE_PROGRESS_PREFIX = '[vitest-file]'
const MAX_MODULE_ID_CHARS = 400

export type FileProgressEvent = 'start' | 'finish'

export type WriteProgress = (chunk: string) => void
type Clock = () => number

export interface FileProgressReporterOptions {
  write?: WriteProgress
  now?: Clock
  /** Marker prefix for each line. Defaults to `DEFAULT_FILE_PROGRESS_PREFIX`. */
  prefix?: string
}

function moduleId(testModule: TestModule): string {
  return testModule.relativeModuleId || testModule.moduleId
}

export function formatFileProgress(
  event: FileProgressEvent,
  moduleId: string,
  state?: string,
  atMs?: number,
  prefix: string = DEFAULT_FILE_PROGRESS_PREFIX,
): string {
  let boundedModuleId = moduleId.slice(0, MAX_MODULE_ID_CHARS)
  if (boundedModuleId.length < moduleId.length) {
    boundedModuleId = `${boundedModuleId.slice(0, -1)}…`
  }
  const stateToken = state !== undefined && /^[a-z]+$/u.test(state) ? ` state=${state}` : ''
  // Epoch milliseconds, so a deadline report can tell a slow file from a stuck one.
  const atToken = atMs !== undefined && Number.isSafeInteger(atMs) ? ` at=${atMs}` : ''
  return `${prefix} event=${event} module=${JSON.stringify(boundedModuleId)}${stateToken}${atToken}\n`
}

class VitestFileProgressReporter implements Reporter {
  private readonly write: WriteProgress
  private readonly now: Clock
  private readonly prefix: string

  constructor(write: WriteProgress, now: Clock, prefix: string) {
    this.write = write
    this.now = now
    this.prefix = prefix
  }

  onTestModuleQueued(testModule: TestModule): void {
    // Queued fires when a worker takes the file, before import. A shard that dies
    // during that file still has this line; the CI minimal reporter prints nothing.
    this.write(
      formatFileProgress('start', moduleId(testModule), undefined, this.now(), this.prefix),
    )
  }

  onTestModuleEnd(testModule: TestModule): void {
    this.write(
      formatFileProgress(
        'finish',
        moduleId(testModule),
        testModule.state(),
        this.now(),
        this.prefix,
      ),
    )
  }
}

function writeProgressLine(chunk: string): void {
  writeSync(process.stdout.fd, chunk)
}

// Appends each event to a file so a quiet CI run keeps its start/finish history without logging it.
export function createFileProgressWriter(filePath: string): WriteProgress {
  return (chunk) => {
    appendFileSync(filePath, chunk)
  }
}

export function createVitestFileProgressReporter(
  options: FileProgressReporterOptions = {},
): VitestFileProgressReporter {
  return new VitestFileProgressReporter(
    options.write ?? writeProgressLine,
    options.now ?? Date.now,
    options.prefix ?? DEFAULT_FILE_PROGRESS_PREFIX,
  )
}

export function isFileProgressReporter(reporter: unknown): reporter is VitestFileProgressReporter {
  return reporter instanceof VitestFileProgressReporter
}
