import type { ConsoleMessage, Page, Request, WebError } from '@playwright/test'
import {
  formatBrowserDialogIssue,
  getBrowserDialogIssueSearchableValues,
  getPageUrl,
  type BrowserDialogIssue,
} from './browser-dialog-issues.mts'

type BrowserWebErrorIssue = {
  error: Error
  pageUrl: string
  type: 'weberror'
}
type BrowserRequestFailedIssue = {
  failureText: string
  frameUrl: string
  method: string
  resourceType: string
  type: 'requestfailed'
  url: string
}
type BrowserConsoleErrorIssue = {
  location: string
  pageUrl: string
  text: string
  type: 'consoleerror'
}
type BrowserPageCrashIssue = { pageUrl: string; type: 'pagecrash' }
export type BrowserIssue =
  | BrowserConsoleErrorIssue
  | BrowserDialogIssue
  | BrowserPageCrashIssue
  | BrowserRequestFailedIssue
  | BrowserWebErrorIssue
export type BrowserIssueAllowlistEntry = {
  pattern: RegExp
  reason: string
  type: BrowserIssue['type']
}
export { createDialogIssue } from './browser-dialog-issues.mts'

export function validateAllowlist(entries: BrowserIssueAllowlistEntry[]) {
  for (const entry of entries) {
    if (!entry.reason.trim()) {
      throw new Error(`Browser issue allowlist entry for ${entry.pattern} must include a reason`)
    }
    const probeValues = [
      '',
      'unrelated browser issue probe',
      'https://example.invalid/unrelated-probe',
    ]
    // The empty probe is skipped so patterns such as /./ and /.+/ are still rejected.
    const matchesEveryProbe = probeValues.filter(Boolean).every((value) => {
      entry.pattern.lastIndex = 0
      return entry.pattern.test(value)
    })
    if (matchesEveryProbe) {
      throw new Error(`Browser issue allowlist entry for ${entry.pattern} is too broad`)
    }
  }
}

function getRequestFrameUrl(request: Request) {
  try {
    return request.frame().url()
  } catch {
    return '(frame URL unavailable)'
  }
}

export function createWebErrorIssue(webError: WebError): BrowserWebErrorIssue {
  return {
    error: webError.error(),
    pageUrl: getPageUrl(webError.page()),
    type: 'weberror',
  }
}

export function createRequestFailedIssue(request: Request): BrowserRequestFailedIssue {
  return {
    failureText: request.failure()?.errorText ?? '(no failure text)',
    frameUrl: getRequestFrameUrl(request),
    method: request.method(),
    resourceType: request.resourceType(),
    type: 'requestfailed',
    url: request.url(),
  }
}

export function createConsoleErrorIssue(message: ConsoleMessage): BrowserConsoleErrorIssue {
  const location = message.location()
  const coordinates = `${location.lineNumber}:${location.columnNumber}`
  return {
    location: location.url ? `${location.url}:${coordinates}` : coordinates,
    pageUrl: getPageUrl(message.page()),
    text: message.text(),
    type: 'consoleerror',
  }
}

export function createPageCrashIssue(page: Page): BrowserPageCrashIssue {
  return { pageUrl: getPageUrl(page), type: 'pagecrash' }
}

export function formatBrowserIssue(issue: BrowserIssue) {
  if (issue.type === 'consoleerror') {
    return [
      '[consoleerror]',
      `Page: ${issue.pageUrl}`,
      `Location: ${issue.location}`,
      issue.text,
    ].join('\n')
  }
  if (issue.type === 'weberror') {
    return [
      '[weberror]',
      `Page: ${issue.pageUrl}`,
      `Message: ${issue.error.message}`,
      issue.error.stack ?? issue.error.message,
    ].join('\n')
  }
  if (issue.type === 'dialog') {
    return formatBrowserDialogIssue(issue)
  }
  if (issue.type === 'pagecrash') {
    return ['[pagecrash]', `Page: ${issue.pageUrl}`, 'The browser page crashed.'].join('\n')
  }
  return [
    '[requestfailed]',
    `${issue.method} ${issue.url}`,
    `Resource: ${issue.resourceType}`,
    `Frame: ${issue.frameUrl}`,
    `Failure: ${issue.failureText}`,
  ].join('\n')
}

export function matchesAllowlist(issue: BrowserIssue, allowlist: BrowserIssueAllowlistEntry[]) {
  const searchableValues =
    issue.type === 'requestfailed'
      ? [issue.url, issue.failureText, issue.frameUrl, issue.resourceType]
      : issue.type === 'consoleerror'
        ? [issue.text, issue.pageUrl, issue.location]
        : issue.type === 'dialog'
          ? getBrowserDialogIssueSearchableValues(issue)
          : issue.type === 'weberror'
            ? [issue.error?.message ?? '', issue.pageUrl]
            : [issue.pageUrl]
  return allowlist.some((entry) => {
    if (entry.type !== issue.type) return false
    return searchableValues.some((value) => {
      entry.pattern.lastIndex = 0
      return entry.pattern.test(value)
    })
  })
}

export function isExpectedBrowserCancellation(issue: BrowserIssue) {
  return issue.type === 'requestfailed' && issue.failureText === 'net::ERR_ABORTED'
}

export function isBrowserSynthesizedResourceLoadError(message: ConsoleMessage): boolean {
  if (!message.text().startsWith('Failed to load resource: ')) return false
  const location = message.location()
  if (location.lineNumber !== 0 || location.columnNumber !== 0) return false
  // JS/CSS/WASM assets that 404 don't emit requestfailed, so let those through
  // so that broken chunk loads are still detectable.
  if (/\.(?:js|mjs|css|wasm)(?:[?#]|$)/i.test(location.url)) return false
  return true
}

function isLocalUrl(value: string) {
  try {
    const { hostname } = new URL(value)
    const normalizedHostname = hostname.replace(/^\[(.*)]$/, '$1')
    return ['', 'localhost', '127.0.0.1', '::1'].includes(normalizedHostname)
  } catch {
    return false
  }
}

export function isRetryableLocalConnectionLoss(issue: BrowserIssue) {
  if (issue.type !== 'requestfailed') return false
  const isLocalRequest =
    isLocalUrl(issue.url) &&
    (issue.frameUrl === '(frame URL unavailable)' || isLocalUrl(issue.frameUrl))
  if (!isLocalRequest) return false
  if (issue.failureText === 'net::ERR_NETWORK_CHANGED') return true
  return (
    issue.resourceType === 'document' &&
    (issue.failureText === 'net::ERR_CONNECTION_RESET' ||
      issue.failureText === 'net::ERR_CONNECTION_REFUSED')
  )
}
