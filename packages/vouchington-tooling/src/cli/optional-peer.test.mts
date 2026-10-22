import { describe, expect, it, vi } from 'vitest'

import { loadWithOptionalPeer } from './optional-peer.mts'

function moduleNotFound(peer: string) {
  return Object.assign(new Error(`Cannot find package '${peer}' imported from /x/analyze.mjs`), {
    code: 'ERR_MODULE_NOT_FOUND',
  })
}

describe('loadWithOptionalPeer', () => {
  it('returns the loaded module', async () => {
    await expect(loadWithOptionalPeer('cmd', 'no-mistakes', async () => 7)).resolves.toBe(7)
  })

  it('explains a missing optional peer', async () => {
    const cause = moduleNotFound('no-mistakes')
    const failure = await loadWithOptionalPeer('cmd', 'no-mistakes', () =>
      Promise.reject(cause),
    ).catch((error: unknown) => error as Error)
    expect(failure.message).toBe(
      'cmd requires the optional peer dependency no-mistakes; install it alongside vouchington-tooling',
    )
    expect(failure.cause).toBe(cause)
  })

  it.each([
    ['another missing package', moduleNotFound('left-pad')],
    ['another error code', Object.assign(new Error("'no-mistakes' broke"), { code: 'EBROKEN' })],
    ['a non-error value', 'boom'],
  ])('rethrows %s unchanged', async (_name, error) => {
    await expect(
      loadWithOptionalPeer('cmd', 'no-mistakes', () => Promise.reject(error)),
    ).rejects.toBe(error)
  })
})

describe('runStoryCoverageLazy', () => {
  it('delegates to the lazily loaded command', async () => {
    vi.resetModules()
    vi.doMock('./commands/story-coverage.mts', () => ({ runStoryCoverage: async () => 3 }))
    const { runStoryCoverageLazy: run } = await import('./story-coverage-lazy.mts')
    await expect(run({} as never)).resolves.toBe(3)
    vi.doUnmock('./commands/story-coverage.mts')
  })
})
