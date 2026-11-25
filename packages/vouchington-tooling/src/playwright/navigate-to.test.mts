import { afterEach, describe, expect, it, vi } from 'vitest'
import { navigateTo } from './navigate-to.mts'

const mockInstallTurnstileStub = vi.fn<() => unknown>()
const mockRetryOnConnectionLost = vi.fn<(...args: Array<never>) => unknown>(
  (fn: () => Promise<unknown>) => fn(),
)

function createMockPage() {
  return {
    goto: vi.fn<() => unknown>().mockResolvedValue(undefined),
    waitForLoadState: vi.fn<() => unknown>().mockResolvedValue(undefined),
    evaluate: vi.fn<() => unknown>().mockResolvedValue(undefined),
  }
}

describe('navigateTo', () => {
  afterEach(() => {
    mockInstallTurnstileStub.mockReset()
    mockRetryOnConnectionLost.mockReset()
    vi.unstubAllGlobals()
  })

  it('installs turnstile stub, waits for load and never for networkidle', async () => {
    const page = createMockPage()

    await navigateTo(
      page as never,
      '/foo',
      {},
      {
        installTurnstileStub: mockInstallTurnstileStub as never,
        retryOnConnectionLost: mockRetryOnConnectionLost as never,
      },
    )

    expect(mockInstallTurnstileStub).toHaveBeenCalledWith(page)
    expect(mockRetryOnConnectionLost).toHaveBeenCalledOnce()
    expect(page.goto).toHaveBeenCalledWith('/foo', { waitUntil: 'domcontentloaded' })
    expect(page.waitForLoadState.mock.calls).toEqual([['load']])
    expect(page.evaluate).toHaveBeenCalledOnce()
  })

  it('settles a client-side redirect to the state it navigated under', async () => {
    const page = createMockPage()
    page.evaluate.mockRejectedValueOnce(
      new Error(
        'page.evaluate: Execution context was destroyed, most likely because of a navigation',
      ),
    )

    await navigateTo(
      page as never,
      '/items/create',
      {},
      {
        installTurnstileStub: mockInstallTurnstileStub as never,
        retryOnConnectionLost: mockRetryOnConnectionLost as never,
      },
    )

    // Once for the first document, once for the one the redirect landed on —
    // both at 'load', never 'networkidle'.
    expect(page.waitForLoadState.mock.calls).toEqual([['load'], ['load']])
    expect(page.evaluate).toHaveBeenCalledTimes(2)
  })

  it('uses the default Turnstile install and connection retry', async () => {
    vi.stubGlobal('window', {
      requestIdleCallback: (callback: () => void) => {
        callback()
      },
    })
    const page = {
      evaluate: vi.fn<(callback: () => Promise<void>) => Promise<void>>((callback) => callback()),
      goto: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      route: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      waitForLoadState: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    }

    await navigateTo(page as never, '/items')

    expect(page.route).toHaveBeenCalledOnce()
    expect(page.goto).toHaveBeenCalledWith('/items', { waitUntil: 'domcontentloaded' })
  })
})
