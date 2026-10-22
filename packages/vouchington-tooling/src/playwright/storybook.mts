import type { APIResponse, Page } from '@playwright/test'

interface StorybookIndex {
  entries?: Record<string, unknown>
}

export async function storybookBundleHasStory(page: Page, id: string): Promise<boolean> {
  let response: APIResponse
  try {
    response = await page.request.get('/storybook/index.json', { timeout: 5000 })
  } catch {
    return false
  }

  if (!response.ok()) return false

  const storyIndex = (await response.json()) as StorybookIndex
  return id in (storyIndex.entries ?? {})
}
