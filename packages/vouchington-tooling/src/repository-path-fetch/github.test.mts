import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGithubJson } from './github.mts'

afterEach(() => vi.unstubAllGlobals())

describe('getGithubJson', () => {
  it('rejects an oversized Content-Length before reading the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{}', { headers: { 'content-length': '4' } })),
    )
    await expect(
      getGithubJson(new URL('https://api.example/'), 'value', 'token', 3),
    ).rejects.toThrow('exceeds size limit')
  })

  it('rejects an oversized streamed body without a Content-Length', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')))
    await expect(
      getGithubJson(new URL('https://api.example/'), 'value', 'token', 1),
    ).rejects.toThrow('exceeds size limit')
  })

  it('rejects successful responses without a readable body', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null)))
    await expect(getGithubJson(new URL('https://api.example/'), 'value', 'token')).rejects.toThrow(
      'has no body',
    )
  })
})
