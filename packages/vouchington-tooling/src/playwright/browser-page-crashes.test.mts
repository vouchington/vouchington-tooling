import { describe, expect, it, vi } from 'vitest'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import { BrowserIssueMonitor } from './browser-errors.mts'

type Listener = (...args: never[]) => void

class MockBrowserContext {
  readonly listeners = new Map<string, Set<Listener>>()
  readonly contextPages: Page[]

  constructor(contextPages: Page[] = []) {
    this.contextPages = contextPages
  }

  emit(event: string, ...args: never[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args)
    }
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  pages() {
    return this.contextPages
  }
}

class MockPage {
  readonly listeners = new Map<string, Set<Listener>>()
  readonly offEvents: string[] = []
  readonly pageUrl: string

  constructor(pageUrl: string) {
    this.pageUrl = pageUrl
  }

  emit(event: string, ...args: never[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args)
    }
  }

  off(event: string, listener: Listener) {
    this.offEvents.push(event)
    this.listeners.get(event)?.delete(listener)
    return this
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  url() {
    return this.pageUrl
  }
}

function createTestInfo() {
  const attachments: { body: Buffer; contentType: string; name: string }[] = []
  const testInfo = {
    attach: vi.fn<(...args: Array<never>) => unknown>(
      (name: string, options: { body: Buffer; contentType: string }) => {
        attachments.push({ name, ...options })
        return Promise.resolve()
      },
    ),
  } as unknown as TestInfo
  return { attachments, testInfo }
}

describe('BrowserIssueMonitor page crashes', () => {
  it('fails with page crash context for existing pages', async () => {
    const { attachments, testInfo } = createTestInfo()
    const page = new MockPage('http://localhost:8787/crashed')
    const context = new MockBrowserContext([page as unknown as Page])
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    page.emit('crash')

    await expect(monitor.assertNoIssues()).rejects.toThrow(/pagecrash/)
    const body = attachments[0]?.body.toString()
    expect(body).toContain('[pagecrash]')
    expect(body).toContain('http://localhost:8787/crashed')
  })

  it('monitors page crashes for pages created after context monitoring starts', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)
    const page = new MockPage('http://localhost:8787/new-page')

    context.emit('page', page as never)
    page.emit('crash')

    await expect(monitor.assertNoIssues()).rejects.toThrow(/pagecrash/)
    expect(attachments[0]?.body.toString()).toContain('http://localhost:8787/new-page')
  })

  it('removes page crash listeners when monitored pages close', async () => {
    const { testInfo } = createTestInfo()
    const page = new MockPage('http://localhost:8787/closed-page')
    const context = new MockBrowserContext([page as unknown as Page])
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    expect(page.listeners.get('crash')?.size).toBe(1)
    expect(page.listeners.get('close')?.size).toBe(1)

    page.emit('close')

    expect(page.listeners.get('crash')?.size).toBe(0)
    expect(page.listeners.get('close')?.size).toBe(0)
    page.emit('crash')
    await expect(monitor.assertNoIssues()).resolves.toBeUndefined()
    expect(page.offEvents).toEqual(['crash', 'close'])

    monitor.dispose()

    expect(page.offEvents).toEqual(['crash', 'close'])
  })

  it('removes crash listeners for pages that are still open', () => {
    const { testInfo } = createTestInfo()
    const page = new MockPage('http://localhost:8787/open-page')
    const context = new MockBrowserContext([page as unknown as Page])
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    monitor.dispose()

    expect(page.offEvents).toEqual(['crash', 'close'])
  })

  it('ignores a second monitor request for a page it already tracks', () => {
    const { testInfo } = createTestInfo()
    const page = new MockPage('http://localhost:8787/twice')
    const context = new MockBrowserContext([page as unknown as Page])
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit('page', page as never)

    expect(page.listeners.get('crash')?.size).toBe(1)
  })
})
