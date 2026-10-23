import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

import {
  isProcessGroupAlive,
  waitForProcessGroupExit,
  type BrowserSessionDeps,
} from '../browser-session-runner/index.mts'
import { samplePsProcessGroup } from './process-sample.mts'
import type { StorybookBrowserRunnerDeps } from './types.mts'

/** browser-session-runner uses this delay for its disabled startup and semantic stall timers. */
export const DISABLED_STALL_TIMER_MS = 2_147_483_647

export const defaultRunnerDeps = (): StorybookBrowserRunnerDeps => ({
  clearInterval,
  clearTimeout,
  cpSync,
  cwd: process.cwd(),
  existsSync,
  isProcessGroupAlive,
  killProcessGroup: (pid, signal) => {
    try {
      process.kill(-pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  },
  mkdirSync,
  now: () => performance.now(),
  offParentSignal: (signal, listener) => process.off(signal, listener),
  onParentSignal: (signal, listener) => process.on(signal, listener),
  rmSync,
  sampleProcessGroup: samplePsProcessGroup,
  setInterval,
  setTimeout,
  spawn,
  stderr: process.stderr,
  stdout: process.stdout,
  waitForProcessGroupExit,
  writeFileSync,
})

/**
 * Adapts the injected runner deps to `browser-session-runner`. Its disabled startup and semantic
 * stall sentinels are the only callers that pass the maximum 32-bit delay, and those timers must
 * not hold the process open, so they use unref'd native timers.
 */
export function createBrowserSessionDeps(deps: StorybookBrowserRunnerDeps): BrowserSessionDeps {
  const sentinelTimers = new Set<ReturnType<typeof setTimeout>>()
  return {
    clearInterval: deps.clearInterval,
    clearTimeout: (handle) => {
      if (sentinelTimers.delete(handle as ReturnType<typeof setTimeout>)) {
        clearTimeout(handle as ReturnType<typeof setTimeout>)
      } else deps.clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    isProcessGroupAlive: deps.isProcessGroupAlive,
    killProcessGroup: deps.killProcessGroup,
    now: deps.now,
    offParentSignal: deps.offParentSignal,
    onParentSignal: deps.onParentSignal,
    setInterval: deps.setInterval,
    setTimeout: (callback, ms) => {
      if (ms !== DISABLED_STALL_TIMER_MS) return deps.setTimeout(callback, ms)
      const timeout = setTimeout(() => {
        sentinelTimers.delete(timeout)
        callback()
      }, ms)
      timeout.unref?.()
      sentinelTimers.add(timeout)
      return timeout
    },
    waitForProcessGroupExit: deps.waitForProcessGroupExit,
  }
}
