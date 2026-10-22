import type { Page, Request, TestInfo } from '@playwright/test'
import { vi } from 'vitest'

type Listener = (...args: never[]) => void

class MockBrowserContext {
  readonly listeners = new Map<string, Set<Listener>>()

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
    return []
  }
}

function createTestInfo() {
  const attachments: { body: Buffer; contentType: string; name: string }[] = []
  const attach = vi.fn<
    (name: string, options: { body: Buffer; contentType: string }) => Promise<void>
  >((name, options) => {
    attachments.push({ name, ...options })
    return Promise.resolve()
  })
  const testInfo = { attach } as unknown as TestInfo
  return { attach, attachments, testInfo }
}

function createPage(url = 'http://localhost:8787/path') {
  return {
    url: () => url,
  } as Page
}

function createRequest(
  overrides: Partial<{
    failureText: null | string
    frameThrows: boolean
    frameUrl: string
    method: string
    resourceType: string
    url: string
  }> = {},
) {
  const {
    failureText = 'net::ERR_FAILED',
    frameThrows = false,
    frameUrl = 'http://localhost:8787/frame',
    method = 'GET',
    resourceType = 'script',
    url = 'https://example.com/script.js',
  } = overrides

  return {
    failure: () => (failureText === null ? null : { errorText: failureText }),
    frame: () => {
      if (frameThrows) throw new Error('frame unavailable')
      return { url: () => frameUrl }
    },
    method: () => method,
    resourceType: () => resourceType,
    url: () => url,
  } as unknown as Request
}

export { createPage, createRequest, createTestInfo, MockBrowserContext }
