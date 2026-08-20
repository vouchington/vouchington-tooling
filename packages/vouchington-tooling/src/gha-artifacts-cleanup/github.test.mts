import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deleteArtifact,
  getRunConclusion,
  githubGet,
  listArtifactsPage,
  listRunArtifacts,
} from './github.mts'

const REPO = 'owner/repo'
const TOKEN = 'test-token'
const noopSleep = async () => {}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('githubGet', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the response immediately on success', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', mockFetch)
    const response = await githubGet('/repos/x/y', TOKEN, noopSleep)
    expect(response.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledOnce()
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['X-GitHub-Api-Version']).toBe('2022-11-28')
  })

  it('retries on 429 using Retry-After, then succeeds', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(jsonResponse({}))
    vi.stubGlobal('fetch', mockFetch)
    const sleepFn = vi.fn<(ms: number) => Promise<void>>(noopSleep)
    const response = await githubGet('/repos/x/y', TOKEN, sleepFn)
    expect(response.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledWith(1000)
  })

  it('falls back to exponential backoff without Retry-After', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse({}))
    vi.stubGlobal('fetch', mockFetch)
    const sleepFn = vi.fn<(ms: number) => Promise<void>>(noopSleep)
    await githubGet('/repos/x/y', TOKEN, sleepFn)
    expect(sleepFn).toHaveBeenCalledWith(1000)
  })

  it('gives up after the retry budget and returns the last response', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', mockFetch)
    const response = await githubGet('/repos/x/y', TOKEN, noopSleep)
    expect(response.status).toBe(429)
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  it('retries a thrown network error then succeeds', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse({}))
    vi.stubGlobal('fetch', mockFetch)
    const response = await githubGet('/repos/x/y', TOKEN, noopSleep)
    expect(response.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('returns a synthetic 599 once network errors exhaust the retry budget', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network down'))
    vi.stubGlobal('fetch', mockFetch)
    const response = await githubGet('/repos/x/y', TOKEN, noopSleep)
    expect(response.status).toBe(599)
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  it('uses a real timer to back off when no sleepFn is injected', async () => {
    vi.useFakeTimers()
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(jsonResponse({}))
    vi.stubGlobal('fetch', mockFetch)
    const pending = githubGet('/repos/x/y', TOKEN)
    await vi.advanceTimersByTimeAsync(1000)
    const response = await pending
    expect(response.ok).toBe(true)
    vi.useRealTimers()
  })
})

describe('deleteArtifact', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps 404, 2xx, and non-retryable statuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
    )
    await expect(deleteArtifact(REPO, TOKEN, 1, noopSleep)).resolves.toBe('not-found')
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
    )
    await expect(deleteArtifact(REPO, TOKEN, 1, noopSleep)).resolves.toBe('deleted')
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
    )
    await expect(deleteArtifact(REPO, TOKEN, 1, noopSleep)).resolves.toBe('failed')
  })

  it('retries 403 then succeeds', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', mockFetch)
    await expect(deleteArtifact(REPO, TOKEN, 1, noopSleep)).resolves.toBe('deleted')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('returns failed after exhausting retries on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 })),
    )
    await expect(deleteArtifact(REPO, TOKEN, 1, noopSleep)).resolves.toBe('failed')
  })

  it('retries a thrown network error then succeeds', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', mockFetch)
    await expect(deleteArtifact(REPO, TOKEN, 1, noopSleep)).resolves.toBe('deleted')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('returns failed once network errors exhaust the retry budget', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network down'))
    vi.stubGlobal('fetch', mockFetch)
    await expect(deleteArtifact(REPO, TOKEN, 1, noopSleep)).resolves.toBe('failed')
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })
})

describe('listRunArtifacts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('paginates until a short page is returned', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: 'coverage-unit',
      size_in_bytes: 1,
      expired: false,
      created_at: '2026-01-01T00:00:00Z',
    }))
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ artifacts: fullPage }))
      .mockResolvedValueOnce(jsonResponse({ artifacts: [fullPage[0]] }))
    vi.stubGlobal('fetch', mockFetch)
    const artifacts = await listRunArtifacts(REPO, TOKEN, '123')
    expect(artifacts).toHaveLength(101)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('stops and returns what it has when a page request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
    )
    await expect(listRunArtifacts(REPO, TOKEN, '123')).resolves.toEqual([])
  })
})

describe('listArtifactsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the artifacts array on success and null on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ artifacts: [{ id: 1 }] })),
    )
    await expect(listArtifactsPage(REPO, TOKEN, 1)).resolves.toEqual([{ id: 1 }])
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
    )
    await expect(listArtifactsPage(REPO, TOKEN, 1)).resolves.toBeNull()
  })
})

describe('getRunConclusion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches and caches the conclusion of a completed run', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: 'completed', conclusion: 'success' }))
    vi.stubGlobal('fetch', mockFetch)
    const cache = new Map<number, string | null>()
    await expect(getRunConclusion(REPO, TOKEN, 1, cache)).resolves.toBe('success')
    await expect(getRunConclusion(REPO, TOKEN, 1, cache)).resolves.toBe('success')
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('returns null for a run that has not completed', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ status: 'in_progress', conclusion: null })),
    )
    await expect(getRunConclusion(REPO, TOKEN, 2, new Map())).resolves.toBeNull()
  })

  it('caches null when the run lookup request fails', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', mockFetch)
    const cache = new Map<number, string | null>()
    await expect(getRunConclusion(REPO, TOKEN, 3, cache)).resolves.toBeNull()
    expect(cache.get(3)).toBeNull()
    await getRunConclusion(REPO, TOKEN, 3, cache)
    expect(mockFetch).toHaveBeenCalledOnce()
  })
})
