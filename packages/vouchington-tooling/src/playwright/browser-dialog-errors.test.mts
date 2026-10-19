import {
  MockBrowserContext,
  createPage,
  createTestInfo,
} from './browser-issue-monitor.test-helpers.mts'

import { describe, expect, it, vi } from 'vitest'

import type { BrowserContext, Dialog, Page } from '@playwright/test'

import { BrowserIssueMonitor } from './browser-errors.mts'

function createDialog(
  overrides: Partial<{
    defaultValue: string
    dismiss: () => Promise<void>
    message: string
    page: null | Page
    type: string
  }> = {},
) {
  const {
    defaultValue = '',
    dismiss = vi.fn<() => Promise<void>>(() => Promise.resolve()),
    message = 'Unexpected confirmation dialog',
    page = createPage(),
    type = 'confirm',
  } = overrides

  return {
    defaultValue: () => defaultValue,
    dismiss,
    message: () => message,
    page: () => page,
    type: () => type,
  } as unknown as Dialog
}

describe('BrowserIssueMonitor browser dialogs', () => {
  it('fails on unexpected browser dialogs and dismisses them', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)
    const dismiss = vi.fn<() => Promise<void>>(() => Promise.resolve())

    context.emit(
      'dialog',
      createDialog({
        defaultValue: 'seeded default',
        dismiss,
        message: 'Delete this seeded record?',
        type: 'prompt',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).rejects.toThrow(/dialog/)
    expect(dismiss).toHaveBeenCalledOnce()
    const body = attachments[0]?.body.toString()
    expect(body).toContain('[dialog]')
    expect(body).toContain('Type: prompt')
    expect(body).toContain('Default: seeded default')
    expect(body).toContain('Delete this seeded record?')
  })

  it('omits empty default values from dialog issue attachments', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit('dialog', createDialog({ message: 'Empty default confirmation' }) as never)

    await expect(monitor.assertNoIssues()).rejects.toThrow(/dialog/)
    const body = attachments[0]?.body.toString()
    expect(body).toContain('Empty default confirmation')
    expect(body).not.toContain('Default:')
  })

  it('allows specific expected dialogs with a reason', async () => {
    const { testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const dismiss = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const monitor = new BrowserIssueMonitor(testInfo, {
      allowlist: [
        {
          pattern: /legacy fixture alert/,
          reason: 'This spec intentionally verifies legacy dialog copy',
          type: 'dialog',
        },
      ],
    })
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit('dialog', createDialog({ dismiss, message: 'legacy fixture alert' }) as never)

    await expect(monitor.assertNoIssues()).resolves.toBeUndefined()
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('records a dialog when the page URL and dismiss both fail', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)
    const page = {
      url: () => {
        throw new Error('url unavailable')
      },
    } as unknown as Page

    context.emit(
      'dialog',
      createDialog({
        dismiss: () => Promise.reject(new Error('already dismissed')),
        message: 'url failed',
        page,
      }) as never,
    )

    await expect(monitor.assertNoIssues()).rejects.toThrow(/dialog/)
    expect(attachments[0]?.body.toString()).toContain('(page URL unavailable)')
  })
})
