import type { Page } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { storybookBundleHasStory } from './storybook.mts'

const STORY_ID = 'components-button--primary'

function createPage(responseOrError: unknown): { page: Page; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn<() => unknown>(() => {
    if (responseOrError instanceof Error) return Promise.reject(responseOrError)
    return Promise.resolve(responseOrError)
  })
  return {
    page: { request: { get } } as unknown as Page,
    get,
  }
}

function createResponse(ok: boolean, body: unknown = {}) {
  return {
    ok: () => ok,
    json: vi.fn<() => unknown>(() => Promise.resolve(body)),
  }
}

describe('storybookBundleHasStory', () => {
  it('returns true when the Storybook index includes the requested story', async () => {
    const { page } = createPage(createResponse(true, { entries: { [STORY_ID]: {} } }))

    await expect(storybookBundleHasStory(page, STORY_ID)).resolves.toBe(true)
  })

  it('returns false when the Storybook index responds without the requested story', async () => {
    const { page } = createPage(
      createResponse(true, { entries: { 'components-button--disabled': {} } }),
    )

    await expect(storybookBundleHasStory(page, STORY_ID)).resolves.toBe(false)
  })

  it('returns false when the index has no entries object', async () => {
    const { page } = createPage(createResponse(true, {}))

    await expect(storybookBundleHasStory(page, STORY_ID)).resolves.toBe(false)
  })

  it('returns false when the Storybook index is not available', async () => {
    const { page } = createPage(createResponse(false))

    await expect(storybookBundleHasStory(page, STORY_ID)).resolves.toBe(false)
  })

  it('returns false when the Storybook index request times out', async () => {
    const { page } = createPage(new Error('apiRequestContext.get: Timeout 10000ms exceeded.'))

    await expect(storybookBundleHasStory(page, STORY_ID)).resolves.toBe(false)
  })

  it('keeps malformed Storybook index responses as hard failures', async () => {
    const jsonError = new Error('invalid json')
    const { page } = createPage({
      ok: () => true,
      json: vi.fn<() => unknown>(() => Promise.reject(jsonError)),
    })

    await expect(storybookBundleHasStory(page, STORY_ID)).rejects.toBe(jsonError)
  })

  it('uses a bounded request timeout for the stale-bundle probe', async () => {
    const { page, get } = createPage(createResponse(false))

    await storybookBundleHasStory(page, STORY_ID)

    expect(get).toHaveBeenCalledWith('/storybook/index.json', { timeout: 5000 })
  })
})
