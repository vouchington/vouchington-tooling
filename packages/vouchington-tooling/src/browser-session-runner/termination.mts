import type { BrowserSessionDeps, BrowserSessionProcess, BrowserSessionResult } from './types.mts'

export type AttemptControl = {
  childExited: boolean
  deps: BrowserSessionDeps
  graceMs: number
  killTimer: unknown
  process: BrowserSessionProcess
  reason: BrowserSessionResult['reason']
  terminating: boolean
}

function signalProcess(control: AttemptControl, value: NodeJS.Signals): void {
  try {
    control.deps.killProcessGroup(control.process.processGroupId, value)
  } catch {}
  try {
    control.process.kill(value)
  } catch {}
}

export function terminateAttempt(
  control: AttemptControl,
  nextReason: BrowserSessionResult['reason'],
): void {
  if (nextReason === 'deadline' && control.childExited && control.reason === 'exit') return
  if (nextReason === 'parent-signal' || nextReason === 'deadline') {
    if (
      control.reason === 'exit' ||
      control.reason === 'startup-stall' ||
      control.reason === 'semantic-stall'
    )
      control.reason = nextReason
    else if (control.reason !== nextReason) return
  } else if (control.reason !== 'exit') return
  else if (nextReason !== 'exit') control.reason = nextReason
  if (control.terminating) return
  control.terminating = true
  control.killTimer = control.deps.setTimeout(() => {
    if (control.deps.isProcessGroupAlive(control.process.processGroupId))
      signalProcess(control, 'SIGKILL')
  }, control.graceMs)
  signalProcess(control, 'SIGTERM')
}
