import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { waitForBelowFoldHydration } from './wait-for-hydration.mts'

function createEvaluatePage() {
  return {
    evaluate: vi.fn<(callback: () => Promise<void>) => Promise<void>>((callback) => callback()),
  } as unknown as Page
}

const DESTROYED_CONTEXT_MESSAGE =
  'page.evaluate: Execution context was destroyed, most likely because of a navigation'

/**
 * A page whose first `destroyedEvaluations` evaluates reject the way Playwright
 * does when a client-side redirect replaces the document mid-evaluate.
 */
function createRedirectingPage(destroyedEvaluations: number) {
  let remaining = destroyedEvaluations
  const waitForLoadState = vi.fn<(state: string) => Promise<void>>().mockResolvedValue(undefined)
  const evaluate = vi.fn<(callback: () => Promise<void>) => Promise<void>>((callback) => {
    if (remaining > 0) {
      remaining -= 1
      return Promise.reject(new Error(DESTROYED_CONTEXT_MESSAGE))
    }
    return callback()
  })
  return { page: { evaluate, waitForLoadState } as unknown as Page, evaluate, waitForLoadState }
}

describe('waitForBelowFoldHydration', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('waits for requestIdleCallback when available', async () => {
    const page = createEvaluatePage()
    const requestIdleCallback = vi.fn<
      (callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) => number
    >((callback) => {
      callback({ didTimeout: false, timeRemaining: () => 0 })
      return 1
    })

    vi.stubGlobal('window', { requestIdleCallback })

    await waitForBelowFoldHydration(page)

    expect(requestIdleCallback).toHaveBeenCalledOnce()
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 500 })
  })

  it('falls back to animation frames without a fixed sleep', async () => {
    const page = createEvaluatePage()
    const frameCallbacks: Array<(time: number) => void> = []
    const requestAnimationFrame = vi.fn<(callback: (time: number) => void) => number>(
      (callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
    )

    vi.stubGlobal('window', {})
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)

    const waitPromise = waitForBelowFoldHydration(page)
    expect(requestAnimationFrame).toHaveBeenCalledOnce()

    frameCallbacks.shift()?.(0)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2)

    frameCallbacks.shift()?.(16)
    await waitPromise
  })

  it('resolves if fallback animation frames are throttled', async () => {
    vi.useFakeTimers()
    const page = createEvaluatePage()
    const requestAnimationFrame = vi.fn<(callback: (time: number) => void) => number>(() => 1)

    vi.stubGlobal('window', {})
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)

    const waitPromise = waitForBelowFoldHydration(page)
    expect(requestAnimationFrame).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(50)
    await waitPromise
    expect(requestAnimationFrame).toHaveBeenCalledOnce()
  })

  it('restarts against the replacement document when a redirect destroys the context', async () => {
    const { page, evaluate, waitForLoadState } = createRedirectingPage(1)
    vi.stubGlobal('window', {
      requestIdleCallback: (callback: () => void) => callback(),
    })

    await waitForBelowFoldHydration(page)

    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(waitForLoadState).toHaveBeenCalledExactlyOnceWith('load')
  })

  it('settles the replacement document to the load state the caller asked for', async () => {
    const { page, waitForLoadState } = createRedirectingPage(1)
    vi.stubGlobal('window', {
      requestIdleCallback: (callback: () => void) => callback(),
    })

    await waitForBelowFoldHydration(page, { waitUntil: 'networkidle' })

    expect(waitForLoadState).toHaveBeenCalledExactlyOnceWith('networkidle')
  })

  it('stops re-waiting once the redirect bound is exhausted', async () => {
    const { page, evaluate, waitForLoadState } = createRedirectingPage(Number.POSITIVE_INFINITY)

    await expect(waitForBelowFoldHydration(page)).rejects.toThrow(DESTROYED_CONTEXT_MESSAGE)

    // Bounded, so a redirect loop fails the test instead of hanging it.
    expect(waitForLoadState).toHaveBeenCalledTimes(2)
    expect(evaluate).toHaveBeenCalledTimes(3)
  })

  it('does not re-wait for an error that is not a destroyed context', async () => {
    const { page, evaluate, waitForLoadState } = createRedirectingPage(0)
    vi.mocked(evaluate).mockRejectedValueOnce(new Error('page.evaluate: boom'))

    await expect(waitForBelowFoldHydration(page)).rejects.toThrow('boom')

    expect(evaluate).toHaveBeenCalledOnce()
    expect(waitForLoadState).not.toHaveBeenCalled()
  })
})
