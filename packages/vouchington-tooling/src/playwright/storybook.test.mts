import type { Page } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { StorybookIndexAccessError, storybookBundleHasStory } from './storybook.mts'

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
    status: () => (ok ? 200 : 503),
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

  it('reports the HTTP status when the Storybook index is not available', async () => {
    const response = createResponse(false)
    const { page } = createPage(response)

    await expect(storybookBundleHasStory(page, STORY_ID)).rejects.toMatchObject({
      name: 'StorybookIndexAccessError',
      kind: 'http',
      status: 503,
      message: 'Storybook index /storybook/index.json returned HTTP 503',
    })
    expect(response.json).not.toHaveBeenCalled()
  })

  it('reports a request failure without exposing credentials from the transport error', async () => {
    const { page, get } = createPage(
      new Error('request to https://user:secret@example.test failed: Authorization: Bearer secret'),
    )

    const result = storybookBundleHasStory(page, STORY_ID)
    await expect(result).rejects.toBeInstanceOf(StorybookIndexAccessError)
    await expect(result).rejects.toMatchObject({
      name: 'StorybookIndexAccessError',
      kind: 'request',
      message: 'Storybook index /storybook/index.json request failed (timeout bound: 5000 ms)',
    })
    await expect(result).rejects.not.toHaveProperty('cause')
    expect(get).toHaveBeenCalledWith('/storybook/index.json', { timeout: 5000 })
  })

  it('reports a timed-out index request as an access failure', async () => {
    const { page } = createPage(new Error('apiRequestContext.get: Timeout 5000ms exceeded.'))

    await expect(storybookBundleHasStory(page, STORY_ID)).rejects.toMatchObject({
      name: 'StorybookIndexAccessError',
      kind: 'request',
    })
  })

  it('preserves unexpected response inspection failures', async () => {
    const inspectionError = new Error('response inspection failed')
    const { page } = createPage({
      ok: () => {
        throw inspectionError
      },
    })

    await expect(storybookBundleHasStory(page, STORY_ID)).rejects.toBe(inspectionError)
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
    const { page, get } = createPage(createResponse(true))

    await storybookBundleHasStory(page, STORY_ID)

    expect(get).toHaveBeenCalledWith('/storybook/index.json', { timeout: 5000 })
  })
})
