import type { TestInfo } from '@playwright/test'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { MonitoredTestInfo } from './monitored-test-info.mts'

describe('MonitoredTestInfo', () => {
  it('accepts a real Playwright TestInfo', () => {
    expectTypeOf<TestInfo>().toExtend<MonitoredTestInfo>()
  })

  it('accepts a minimal object literal', () => {
    const attachments: string[] = []
    const minimal = {
      expectedStatus: 'passed',
      status: 'passed',
      timeout: 1000,
      attach: async (name: string) => {
        attachments.push(name)
      },
    } satisfies MonitoredTestInfo
    expectTypeOf(minimal).toExtend<MonitoredTestInfo>()
    expect(minimal.timeout).toBe(1000)
  })

  it('rejects an object missing a required member', () => {
    expectTypeOf<{ timeout: number }>().not.toExtend<MonitoredTestInfo>()
  })
})
