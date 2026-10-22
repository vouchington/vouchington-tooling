import type {
  BrowserContext,
  ConsoleMessage,
  Dialog,
  Page,
  Request,
  WebError,
} from '@playwright/test'
import {
  createConsoleErrorIssue,
  createDialogIssue,
  createPageCrashIssue,
  createRequestFailedIssue,
  createWebErrorIssue,
  formatBrowserIssue,
  isBrowserSynthesizedResourceLoadError,
  isExpectedBrowserCancellation,
  isRetryableLocalConnectionLoss,
  matchesAllowlist,
  type BrowserIssue,
  type BrowserIssueAllowlistEntry,
  validateAllowlist,
} from './browser-issue-records.mts'
import type { MonitoredTestInfo } from './monitored-test-info.mts'

interface BrowserIssueMonitorOptions {
  allowlist?: BrowserIssueAllowlistEntry[]
  warningPattern?: RegExp
}
const REACT_RENDER_WARNING_PATTERN =
  /hydration|Encountered a script tag|Text content (?:does|did) not match|prop\b.*\bdid not match\b|\bdid not match\.\s*Server\b|Warning: An update to/i
interface MonitoredContext {
  consoleListener: (message: ConsoleMessage) => void
  context: BrowserContext
  dialogListener: (dialog: Dialog) => void
  pageListener: (page: Page) => void
  pages: MonitoredPage[]
  requestFailedListener: (request: Request) => void
  webErrorListener: (webError: WebError) => void
}
interface MonitoredPage {
  closeListener: () => void
  crashListener: () => void
  page: Page
}

export class BrowserIssueMonitor {
  private readonly allowlist: BrowserIssueAllowlistEntry[]
  private readonly issues: BrowserIssue[] = []
  private readonly monitoredContexts: MonitoredContext[] = []
  private readonly testInfo: MonitoredTestInfo
  private readonly warningPattern: RegExp
  constructor(testInfo: MonitoredTestInfo, options: BrowserIssueMonitorOptions = {}) {
    this.allowlist = options.allowlist ?? []
    this.warningPattern = options.warningPattern ?? REACT_RENDER_WARNING_PATTERN
    validateAllowlist(this.allowlist)
    this.testInfo = testInfo
  }
  monitorContext(context: BrowserContext) {
    if (this.monitoredContexts.some((monitored) => monitored.context === context)) return
    const consoleListener = (message: ConsoleMessage) => {
      if (
        // `console.assert(false, ...)` fires a console event with type `assert`.
        // We treat these the same as `console.error`: both are browser-side failures
        // that should fail the test. Both are recorded as `type: 'consoleerror'` in the
        // issue record, so allowlist entries of type `'consoleerror'` cover both.
        (message.type() === 'assert' || message.type() === 'error') &&
        !isBrowserSynthesizedResourceLoadError(message)
      ) {
        this.recordIssue(createConsoleErrorIssue(message))
      } else if (message.type() === 'warning') {
        // Global and sticky patterns keep lastIndex between test() calls.
        this.warningPattern.lastIndex = 0
        if (this.warningPattern.test(message.text())) {
          this.recordIssue(createConsoleErrorIssue(message))
        }
      }
    }
    const webErrorListener = (webError: WebError) => {
      this.recordIssue(createWebErrorIssue(webError))
    }
    const dialogListener = (dialog: Dialog) => {
      const issue = createDialogIssue(dialog)
      if (!matchesAllowlist(issue, this.allowlist)) this.recordIssue(issue)
      void dialog.dismiss().catch(() => undefined)
    }
    const requestFailedListener = (request: Request) => {
      this.recordIssue(createRequestFailedIssue(request))
    }
    const pages: MonitoredPage[] = []
    const monitorPage = (page: Page) => {
      if (pages.some((monitored) => monitored.page === page)) return
      const crashListener = () => {
        this.recordIssue(createPageCrashIssue(page))
      }
      const closeListener = () => {
        page.off('crash', crashListener)
        page.off('close', closeListener)
        const pageIndex = pages.findIndex((monitored) => monitored.page === page)
        if (pageIndex !== -1) {
          pages.splice(pageIndex, 1)
        }
      }
      page.on('crash', crashListener)
      page.on('close', closeListener)
      pages.push({ closeListener, crashListener, page })
    }
    context.on('console', consoleListener)
    context.on('dialog', dialogListener)
    context.on('page', monitorPage)
    context.on('weberror', webErrorListener)
    context.on('requestfailed', requestFailedListener)
    for (const page of context.pages()) {
      monitorPage(page)
    }
    this.monitoredContexts.push({
      consoleListener,
      context,
      dialogListener,
      pageListener: monitorPage,
      pages,
      requestFailedListener,
      webErrorListener,
    })
  }
  dispose() {
    for (const monitored of this.monitoredContexts.splice(0)) {
      const { context } = monitored
      context.off('console', monitored.consoleListener)
      context.off('dialog', monitored.dialogListener)
      context.off('page', monitored.pageListener)
      context.off('weberror', monitored.webErrorListener)
      context.off('requestfailed', monitored.requestFailedListener)
      for (const monitoredPage of monitored.pages) {
        monitoredPage.page.off('crash', monitoredPage.crashListener)
        monitoredPage.page.off('close', monitoredPage.closeListener)
      }
    }
  }
  async attachIssuesIfAny() {
    if (this.issues.length === 0) return false
    await this.testInfo.attach('browser-issues.txt', {
      body: Buffer.from(this.formatIssues()),
      contentType: 'text/plain',
    })
    return true
  }
  async assertNoIssues() {
    if (!(await this.attachIssuesIfAny())) return
    const issueCount = this.issues.length
    const issueWord = issueCount === 1 ? 'issue' : 'issues'
    throw new Error(
      `Unhandled browser ${issueWord} detected (${issueCount}). See browser-issues.txt attachment.\n\n${this.formatIssueSummary()}`,
    )
  }
  private formatIssues() {
    return this.issues.map(formatBrowserIssue).join('\n\n---\n\n')
  }
  private formatIssueSummary() {
    return this.issues.slice(0, 3).map(formatBrowserIssue).join('\n\n---\n\n')
  }

  private recordIssue(issue: BrowserIssue) {
    if (isExpectedBrowserCancellation(issue)) return
    if (isRetryableLocalConnectionLoss(issue)) return
    if (matchesAllowlist(issue, this.allowlist)) return
    this.issues.push(issue)
  }
}
