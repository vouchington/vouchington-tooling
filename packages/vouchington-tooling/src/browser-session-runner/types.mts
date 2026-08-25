import type { ChildProcess } from 'node:child_process'

export type BrowserSessionEvent = 'startup' | 'semantic'
export type BrowserSessionExit = { code: number | null; signal: NodeJS.Signals | null }
type BrowserSessionStream = {
  on(event: 'data', listener: (chunk: string | Buffer) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}
export type BrowserSessionResult = {
  attempts: number
  deadlineExceeded: boolean
  diagnosticTail: string
  exit: BrowserSessionExit
  reason: 'exit' | 'parent-signal' | 'semantic-stall' | 'startup-stall' | 'deadline'
  startupProgress: boolean
  semanticProgress: boolean
}
export type BrowserSessionProcess = Pick<ChildProcess, 'kill'> & {
  processGroupId: number
  on(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  stderr?: BrowserSessionStream | null
  stdout?: BrowserSessionStream | null
}
export type BrowserSessionDeps = {
  clearInterval(handle: unknown): void
  clearTimeout(handle: unknown): void
  isProcessGroupAlive(processGroupId: number): boolean
  killProcessGroup(processGroupId: number, signal: NodeJS.Signals): void
  now(): number
  offParentSignal(signal: NodeJS.Signals, listener: () => void): void
  onParentSignal(signal: NodeJS.Signals, listener: () => void): void
  setInterval(callback: () => void, ms: number): unknown
  setTimeout(callback: () => void, ms: number): unknown
  waitForProcessGroupExit(processGroupId: number, timeoutMs: number): Promise<void>
}
export type BrowserSessionOptions = {
  attempts: number
  classifyExit(
    exit: BrowserSessionExit,
    result: Omit<BrowserSessionResult, 'attempts'>,
  ): 'retry' | 'return'
  deadlineMs: number
  diagnosticTailBytes?: number
  graceMs: number
  onLine(line: string): BrowserSessionEvent | undefined
  processGroupDrainMs?: number
  semanticStallMs: number
  start(attempt: number): BrowserSessionProcess
  startupStallMs: number
  watchdogIntervalMs?: number
}
