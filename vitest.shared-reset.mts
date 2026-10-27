import { afterAll, vi } from 'vitest'

// A reused worker keeps whatever globals, env, spies, and timers a file left behind.
afterAll(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
