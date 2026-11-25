import type { BrowserContext, Page } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearCookiesPreservingLocalStorage,
  removeLocalStorageKeys,
  removeLocalStorageKeysBeforeNavigation,
  resetAnonymousBrowserStateBeforeNavigation,
} from './index.mts'

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  } else {
    delete (globalThis as Record<string, unknown>)['localStorage']
  }
})

function stubLocalStorage() {
  const removed: string[] = []
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      removeItem(key: string) {
        removed.push(key)
      },
    },
  })
  return removed
}

function createMockPage() {
  const context = {
    clearCookies: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
  const addInitScript = vi
    .fn<(fn: (keys: string[]) => void, arg: string[]) => Promise<void>>()
    .mockImplementation(async (fn, arg) => {
      fn(arg)
    })
  const evaluate = vi
    .fn<(fn: (keys: string[]) => void, arg: string[]) => Promise<void>>()
    .mockImplementation(async (fn, arg) => {
      fn(arg)
    })
  const page = {
    addInitScript,
    context: vi.fn<() => typeof context>().mockReturnValue(context),
    evaluate,
  }
  return { page: page as unknown as Page, context, addInitScript, evaluate }
}

describe('browser-state helpers', () => {
  it('clears cookies without touching localStorage', async () => {
    const context = {
      clearCookies: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    }
    await clearCookiesPreservingLocalStorage(context as unknown as BrowserContext)
    expect(context.clearCookies).toHaveBeenCalledOnce()
  })

  it('dedupes localStorage keys for pre-navigation cleanup and removes each key', async () => {
    const removed = stubLocalStorage()
    const { page, addInitScript } = createMockPage()

    await removeLocalStorageKeysBeforeNavigation(page, ['feed-style', 'theme', 'feed-style'])

    expect(addInitScript).toHaveBeenCalledOnce()
    expect(addInitScript.mock.calls[0]?.[1]).toStrictEqual(['feed-style', 'theme'])
    expect(removed).toStrictEqual(['feed-style', 'theme'])
  })

  it('removes deduped localStorage keys on an already-loaded origin', async () => {
    const removed = stubLocalStorage()
    const { page, evaluate } = createMockPage()

    await removeLocalStorageKeys(page, ['theme', 'theme'])

    expect(evaluate).toHaveBeenCalledOnce()
    expect(evaluate.mock.calls[0]?.[1]).toStrictEqual(['theme'])
    expect(removed).toStrictEqual(['theme'])
  })

  it('clears cookies and queues pre-navigation localStorage cleanup', async () => {
    const removed = stubLocalStorage()
    const { page, context, addInitScript, evaluate } = createMockPage()

    await resetAnonymousBrowserStateBeforeNavigation(page, ['list-style'])

    expect(context.clearCookies).toHaveBeenCalledOnce()
    expect(addInitScript.mock.calls[0]?.[1]).toStrictEqual(['list-style'])
    expect(evaluate).not.toHaveBeenCalled()
    expect(removed).toStrictEqual(['list-style'])
  })
})
