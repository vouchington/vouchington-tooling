import type { TestInfo } from '@playwright/test'

/**
 * The members of Playwright's `TestInfo` that the browser-issue helpers read or call.
 * A real `TestInfo` is assignable to it, and so is a small object literal.
 */
export interface MonitoredTestInfo {
  attach(name: string, options: { body: Buffer; contentType: string }): Promise<void>
  readonly expectedStatus: TestInfo['expectedStatus']
  readonly status?: TestInfo['status']
  readonly timeout: number
}
