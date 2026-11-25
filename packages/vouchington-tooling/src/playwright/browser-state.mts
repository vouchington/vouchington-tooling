import type { BrowserContext, Page } from '@playwright/test'

type BrowserLocalStorage = {
  removeItem: (key: string) => void
}

function removeStorageKeys(keysToRemove: string[]): void {
  const storage = (globalThis as typeof globalThis & { localStorage: BrowserLocalStorage })
    .localStorage
  for (const key of keysToRemove) storage.removeItem(key)
}

export async function clearCookiesPreservingLocalStorage(context: BrowserContext): Promise<void> {
  await context.clearCookies()
}

export async function removeLocalStorageKeysBeforeNavigation(
  page: Page,
  keys: readonly string[],
): Promise<void> {
  const storageKeys = [...new Set(keys)]
  await page.addInitScript(removeStorageKeys, storageKeys)
}

export async function removeLocalStorageKeys(page: Page, keys: readonly string[]): Promise<void> {
  const storageKeys = [...new Set(keys)]
  await page.evaluate(removeStorageKeys, storageKeys)
}

export async function resetAnonymousBrowserStateBeforeNavigation(
  page: Page,
  keys: readonly string[],
): Promise<void> {
  await clearCookiesPreservingLocalStorage(page.context())
  await removeLocalStorageKeysBeforeNavigation(page, keys)
}
