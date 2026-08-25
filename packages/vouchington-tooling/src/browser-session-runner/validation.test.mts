import { describe, expect, it } from 'vitest'

import { runBrowserSession, type BrowserSessionDeps } from './index.mts'

const deps: BrowserSessionDeps = {
  clearInterval: () => {},
  clearTimeout: () => {},
  isProcessGroupAlive: () => false,
  killProcessGroup: () => {},
  now: () => 0,
  offParentSignal: () => {},
  onParentSignal: () => {},
  setInterval: () => undefined,
  setTimeout: () => undefined,
  waitForProcessGroupExit: async () => {},
}

const options = {
  attempts: 1,
  classifyExit: () => 'return' as const,
  deadlineMs: 1,
  graceMs: 1,
  onLine: () => undefined,
  semanticStallMs: 1,
  start: () => {
    throw new Error('must not start')
  },
  startupStallMs: 1,
}

describe('browser-session-runner validation', () => {
  it('rejects invalid lifecycle budgets before starting a process', async () => {
    for (const [property, value] of [
      ['attempts', 0],
      ['deadlineMs', Infinity],
      ['graceMs', -1],
      ['processGroupDrainMs', 0],
      ['semanticStallMs', 1.5],
      ['startupStallMs', 0],
      ['watchdogIntervalMs', 0],
      ['diagnosticTailBytes', 0],
      ['deadlineMs', 2_147_483_648],
      ['graceMs', 2_147_483_648],
      ['processGroupDrainMs', 2_147_483_648],
      ['semanticStallMs', 2_147_483_648],
      ['startupStallMs', 2_147_483_648],
      ['watchdogIntervalMs', 2_147_483_648],
      ['graceMs', 2_147_483_647],
    ] as const)
      await expect(runBrowserSession({ ...options, [property]: value }, deps)).rejects.toThrow(
        property,
      )
  })
})
