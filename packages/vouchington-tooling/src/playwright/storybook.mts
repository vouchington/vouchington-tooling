import type { APIResponse, Page } from '@playwright/test'

interface StorybookIndex {
  entries?: Record<string, unknown>
}

const INDEX_PATH = '/storybook/index.json'
const REQUEST_TIMEOUT_MS = 5000

export class StorybookIndexAccessError extends Error {
  readonly kind: 'request' | 'http'
  readonly status: number | undefined

  constructor(status?: number) {
    super(
      status === undefined
        ? `Storybook index ${INDEX_PATH} request failed (timeout bound: ${REQUEST_TIMEOUT_MS} ms)`
        : `Storybook index ${INDEX_PATH} returned HTTP ${status}`,
    )
    this.name = 'StorybookIndexAccessError'
    this.kind = status === undefined ? 'request' : 'http'
    this.status = status
  }
}

export async function storybookBundleHasStory(page: Page, id: string): Promise<boolean> {
  let response: APIResponse
  try {
    response = await page.request.get(INDEX_PATH, { timeout: REQUEST_TIMEOUT_MS })
  } catch {
    // Playwright transport errors can contain request URLs and headers with credentials.
    throw new StorybookIndexAccessError()
  }

  if (!response.ok()) throw new StorybookIndexAccessError(response.status())

  const storyIndex = (await response.json()) as StorybookIndex
  return id in (storyIndex.entries ?? {})
}
