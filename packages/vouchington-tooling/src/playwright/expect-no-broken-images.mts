import type { Page } from '@playwright/test'

interface ImageResponseGuard {
  assertNoImageFailures(): void
}

/**
 * Registers response and requestfailed listeners on `page` to record any image
 * requests that fail at the network level or return a non-2xx HTTP status.
 *
 * Call once at the top of a test, then call `assertNoImageFailures()` after the
 * interaction under test completes. This is the network-level gate — it catches
 * off-screen and lazy-loaded images that a visible-element poll cannot see.
 *
 * Any image failure during the test surfaces here. Ignore a known-flaky host in
 * the caller's network policy instead of suppressing the error here.
 */
export function installImageResponseGuard(page: Page): ImageResponseGuard {
  const failures: Array<{ url: string; status: number | null }> = []

  // Treat 2xx (success) and 3xx (304 Not Modified, redirect hops) as healthy — Playwright
  // emits a response event for each hop, and the terminal response is what matters.
  page.on('response', (response) => {
    const status = response.status()
    if (status >= 200 && status < 400) return
    if (response.request().resourceType() === 'image') {
      failures.push({ url: response.url(), status })
    }
  })

  page.on('requestfailed', (request) => {
    if (request.resourceType() === 'image') {
      failures.push({ url: request.url(), status: null })
    }
  })

  return {
    assertNoImageFailures() {
      if (failures.length === 0) return
      const details = failures
        .map((failure) => `  ${failure.status ?? 'failed'} ${failure.url}`)
        .join('\n')
      throw new Error(`${failures.length} image(s) failed to load:\n${details}`)
    },
  }
}
