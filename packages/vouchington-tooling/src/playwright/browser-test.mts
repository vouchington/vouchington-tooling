import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { BrowserIssueMonitor } from './browser-errors.mts'
import type { BrowserIssueAllowlistEntry } from './browser-issue-records.mts'
import {
  BLOCKED_EXTERNAL_NETWORK_RULES,
  blockedExternalRequestFailureAllowlist,
  installBlockedExternalNetwork,
  type BlockedExternalNetworkRule,
} from './blocked-external-network.mts'

export interface BrowserTestOptions {
  allowlist?: readonly BrowserIssueAllowlistEntry[]
  assertTimeout?: (timeout: number, label: string) => void
  /** Replaces the default GTM/GA/DoubleClick rules; spread BLOCKED_EXTERNAL_NETWORK_RULES to extend them. */
  rules?: readonly BlockedExternalNetworkRule[]
  warningPattern?: RegExp
}

interface BrowserErrorFixtures {
  browserErrors: BrowserIssueMonitor
}

function monitorOptions(options: BrowserTestOptions) {
  const allowlist = [
    ...(options.allowlist ?? blockedExternalRequestFailureAllowlist([], options.rules)),
  ]
  if (options.warningPattern === undefined) return { allowlist }
  return { allowlist, warningPattern: options.warningPattern }
}

export function createBrowserErrorsFixture(options: BrowserTestOptions = {}) {
  const rules = options.rules ?? BLOCKED_EXTERNAL_NETWORK_RULES
  return async function browserErrorsFixture(
    { context }: { context: BrowserContext },
    run: (monitor: BrowserIssueMonitor) => Promise<void>,
    testInfo: TestInfo,
  ) {
    options.assertTimeout?.(testInfo.timeout, 'Playwright effective test timeout')
    const monitor = new BrowserIssueMonitor(testInfo, monitorOptions(options))
    await installBlockedExternalNetwork(context, rules)
    monitor.monitorContext(context)
    try {
      try {
        await run(monitor)
      } catch (error) {
        await monitor.attachIssuesIfAny()
        throw error
      }
      if (testInfo.status === testInfo.expectedStatus) await monitor.assertNoIssues()
      else await monitor.attachIssuesIfAny()
    } finally {
      monitor.dispose()
    }
  }
}

export function createBrowserTest(options: BrowserTestOptions = {}) {
  return base.extend<BrowserErrorFixtures>({
    browserErrors: [createBrowserErrorsFixture(options), { auto: true }],
  })
}

export const test = createBrowserTest()

export { expect }

export async function withMonitoredPage<T>(
  browserOrContext: Browser | BrowserContext,
  testInfo: TestInfo,
  callback: (page: Page) => Promise<T>,
  options: BrowserTestOptions = {},
) {
  options.assertTimeout?.(testInfo.timeout, 'Playwright effective test timeout')
  const monitor = new BrowserIssueMonitor(testInfo, monitorOptions(options))
  const page = await browserOrContext.newPage()
  let removeRoutes: (() => Promise<void>) | undefined
  try {
    removeRoutes = await installBlockedExternalNetwork(
      page.context(),
      options.rules ?? BLOCKED_EXTERNAL_NETWORK_RULES,
    )
    monitor.monitorContext(page.context())
    let result: T
    try {
      result = await callback(page)
    } catch (error) {
      await monitor.attachIssuesIfAny()
      throw error
    }
    await monitor.assertNoIssues()
    return result
  } finally {
    monitor.dispose()
    await removeRoutes?.()
    await page.close().catch(() => undefined)
  }
}
