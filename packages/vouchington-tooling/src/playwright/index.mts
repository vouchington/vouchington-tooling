import TestLifecycleReporter from './test-lifecycle-reporter.mts'

export { BrowserIssueMonitor } from './browser-errors.mts'
export type { BrowserIssueAllowlistEntry } from './browser-issue-records.mts'
export {
  createDialogIssue,
  formatBrowserDialogIssue,
  getBrowserDialogIssueSearchableValues,
  getPageUrl,
} from './browser-dialog-issues.mts'
export type { BrowserDialogIssue } from './browser-dialog-issues.mts'
export {
  createConsoleErrorIssue,
  createPageCrashIssue,
  createRequestFailedIssue,
  createWebErrorIssue,
  formatBrowserIssue,
  isBrowserSynthesizedResourceLoadError,
  isExpectedBrowserCancellation,
  isRetryableLocalConnectionLoss,
  matchesAllowlist,
  validateAllowlist,
} from './browser-issue-records.mts'
export type { BrowserIssue } from './browser-issue-records.mts'
export {
  BLOCKED_EXTERNAL_NETWORK_RULES,
  blockedExternalRequestFailureAllowlist,
  installBlockedExternalNetwork,
  isBlockedExternalNetworkUrl,
} from './blocked-external-network.mts'
export type { BlockedExternalNetworkRule } from './blocked-external-network.mts'
export {
  createBrowserErrorsFixture,
  createBrowserTest,
  expect,
  test,
  withMonitoredPage,
} from './browser-test.mts'
export type { BrowserTestOptions } from './browser-test.mts'
export type { Browser, BrowserContext, Locator, Page, Request, TestInfo } from '@playwright/test'
export { navigateTo } from './navigate-to.mts'
export { retryOnConnectionLost } from './retry-on-connection-lost.mts'
export { forceMainScrollableBeforeHydration, scrollToLoadMore } from './scroll-to-load-more.mts'
export {
  DEFAULT_TURNSTILE_STUB_ATTRIBUTE,
  DEFAULT_TURNSTILE_STUB_TOKEN,
  installTurnstileStub,
} from './turnstile-stub.mts'
export type { TurnstileStubOptions } from './turnstile-stub.mts'
export { waitForBelowFoldHydration } from './wait-for-hydration.mts'
export { requireTestValue } from './assertions.mts'
export { installImageResponseGuard } from './expect-no-broken-images.mts'
export { assertNoHorizontalScroll, getHorizontalOverflowState } from './mobile-assertions.mts'
export type { HorizontalOverflowState } from './mobile-assertions.mts'
export { openRadixDropdown } from './radix-select.mts'
export { randomSuffix } from './random-id.mts'
export { storybookBundleHasStory } from './storybook.mts'
export { TEST_PNG } from './test-fixtures.mts'
export { TestLifecycleReporter }
export { generateTotpCode } from './totp.mts'
export { DESKTOP_VIEWPORT, MOBILE_VIEWPORTS } from './viewport-constants.mts'
export { setupVirtualAuthenticator } from './virtual-authenticator.mts'
