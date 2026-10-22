import type { Dialog, Page } from '@playwright/test'

export type BrowserDialogIssue = {
  defaultValue: string
  dialogType: string
  message: string
  pageUrl: string
  type: 'dialog'
}

export function getPageUrl(page: null | Page) {
  if (!page) return '(no page)'
  try {
    return page.url()
  } catch {
    return '(page URL unavailable)'
  }
}

export function createDialogIssue(dialog: Dialog): BrowserDialogIssue {
  return {
    defaultValue: dialog.defaultValue(),
    dialogType: dialog.type(),
    message: dialog.message(),
    pageUrl: getPageUrl(dialog.page()),
    type: 'dialog',
  }
}

export function formatBrowserDialogIssue(issue: BrowserDialogIssue) {
  const details = ['[dialog]', `Page: ${issue.pageUrl}`, `Type: ${issue.dialogType}`]
  if (issue.defaultValue) details.push(`Default: ${issue.defaultValue}`)
  details.push(issue.message)
  return details.join('\n')
}

export function getBrowserDialogIssueSearchableValues(issue: BrowserDialogIssue) {
  return [issue.message, issue.pageUrl, issue.dialogType, issue.defaultValue]
}
