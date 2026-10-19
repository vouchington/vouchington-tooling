import type { CliOptions } from 'vitest/node'

export type TimeoutProfile = {
  name: string
  admitted: boolean
  options?: CliOptions
  configHookTimeout?: number
  child?: boolean
  withoutGuard?: boolean
}

export function timeoutProfiles(maxTimeoutMs: number): readonly TimeoutProfile[] {
  const midCap: TimeoutProfile[] =
    maxTimeoutMs >= 15_000
      ? [{ name: 'bounded-fifteen', options: { testTimeout: 15_000 }, admitted: true }]
      : []
  return [
    { name: 'bounded-five', admitted: true },
    ...midCap,
    { name: 'bounded-thirty', options: { testTimeout: maxTimeoutMs }, admitted: true },
    { name: 'oversized-cli', options: { testTimeout: maxTimeoutMs + 1 }, admitted: false },
    { name: 'disabled-test', options: { testTimeout: 0 }, admitted: false },
    { name: 'infinite-test', options: { testTimeout: Infinity }, admitted: false },
    { name: 'disabled-hook', configHookTimeout: 0, admitted: false },
    { name: 'infinite-hook', configHookTimeout: Infinity, admitted: false },
    { name: 'unused-root-zero', child: true, admitted: true },
    {
      name: 'reporter-does-not-bypass',
      options: { testTimeout: maxTimeoutMs + 1, reporters: ['json'] },
      admitted: false,
    },
    {
      name: 'normalized-child-hook-zero',
      options: { hookTimeout: 0 },
      child: true,
      admitted: true,
    },
    {
      name: 'removed-guard-negative',
      options: { testTimeout: maxTimeoutMs + 1 },
      withoutGuard: true,
      admitted: true,
    },
  ]
}
