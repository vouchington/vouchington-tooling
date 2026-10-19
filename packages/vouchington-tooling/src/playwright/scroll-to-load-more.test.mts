import { describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { forceMainScrollableBeforeHydration, scrollToLoadMore } from './scroll-to-load-more.mts'

const VIEWPORT = { width: 1280, height: 720 } as const
const BELOW_FOLD_BOX = { x: 0, y: 2000, width: 120, height: 48 }
const IN_VIEW_BOX = { x: 0, y: 80, width: 120, height: 48 }

function createPage(options: {
  counts: number[]
  boxes: Array<typeof BELOW_FOLD_BOX | typeof IN_VIEW_BOX | null>
  boxThrows?: boolean
  remountOnWait?: boolean
}): {
  getByTestId: ReturnType<typeof vi.fn<(id: string) => unknown>>
  page: Page
  waitFor: ReturnType<typeof vi.fn<(opts: { state: string; timeout: number }) => Promise<void>>>
  wheel: ReturnType<typeof vi.fn<(x: number, y: number) => Promise<void>>>
} {
  let countCalls = 0
  let boxCalls = 0
  let scrollTop = 0
  const sentinel = {
    count: vi.fn<() => Promise<number>>(async () => {
      const value = options.counts[Math.min(countCalls, options.counts.length - 1)]!
      countCalls += 1
      return value
    }),
    boundingBox: vi.fn<(opts?: { timeout?: number }) => Promise<typeof BELOW_FOLD_BOX | null>>(
      async () => {
        const value = options.boxes[Math.min(boxCalls, options.boxes.length - 1)] ?? null
        boxCalls += 1
        if (value === null && options.boxThrows) throw new Error('detached during bounding box')
        return value
      },
    ),
    waitFor: vi.fn<(opts: { state: string; timeout: number }) => Promise<void>>(async () => {
      if (options.remountOnWait) return
      throw new Error('sentinel still detached')
    }),
  }
  const getByTestId = vi.fn<(id: string) => typeof sentinel>(() => sentinel)
  const wheel = vi.fn<(x: number, y: number) => Promise<void>>(async (_x, y) => {
    scrollTop += y
  })

  return {
    getByTestId,
    page: {
      getByTestId,
      viewportSize: vi.fn<() => typeof VIEWPORT | null>(() => VIEWPORT),
      mouse: {
        move: vi.fn<(x: number, y: number) => Promise<void>>().mockResolvedValue(undefined),
        wheel,
      },
      evaluate: vi.fn<(fn: () => unknown) => Promise<unknown>>(async (fn) => {
        const source = Function.prototype.toString.call(fn)
        if (!source.includes('scrollTop') && !source.includes('scrollHeight')) return undefined
        const previousDocument = (globalThis as { document?: unknown }).document
        const previousWindow = (globalThis as { window?: unknown }).window
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: {
            documentElement: { scrollHeight: 4000 },
            scrollingElement: { scrollTop },
          },
        })
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: { innerHeight: VIEWPORT.height },
        })
        try {
          return await fn()
        } finally {
          Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: previousDocument,
          })
          Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
        }
      }),
    } as unknown as Page,
    waitFor: sentinel.waitFor,
    wheel,
  }
}

describe('scrollToLoadMore', () => {
  it('succeeds when the sentinel unmounts after it was seen below the fold', async () => {
    const { getByTestId, page, wheel } = createPage({
      counts: [1, 1, 0, 0],
      boxes: [BELOW_FOLD_BOX, BELOW_FOLD_BOX],
    })

    await expect(scrollToLoadMore(page)).resolves.toBeUndefined()
    expect(wheel).toHaveBeenCalledTimes(2)
    expect(getByTestId).toHaveBeenCalledWith('infinite-scroll-sentinel')
  })

  it('looks up a caller-supplied sentinel test id', async () => {
    const { getByTestId, page } = createPage({
      counts: [1],
      boxes: [IN_VIEW_BOX],
    })

    await expect(
      scrollToLoadMore(page, { sentinelTestId: 'caller-sentinel' }),
    ).resolves.toBeUndefined()
    expect(getByTestId).toHaveBeenCalledWith('caller-sentinel')
  })

  it('records a bounding-box timeout and keeps scrolling', async () => {
    const { page } = createPage({
      boxThrows: true,
      boxes: [null, IN_VIEW_BOX],
      counts: [1, 1],
    })

    await expect(scrollToLoadMore(page)).resolves.toBeUndefined()
  })

  it('still fails when the sentinel is detached on every attempt', async () => {
    const { page } = createPage({ counts: [0], boxes: [] })

    await expect(scrollToLoadMore(page)).rejects.toThrow(
      /sentinel was detached from the DOM on every attempt/,
    )
  })

  it('probes a remounted sentinel without wheeling past it', async () => {
    const { page, waitFor } = createPage({
      counts: [1, 0, 1],
      boxes: [BELOW_FOLD_BOX, IN_VIEW_BOX],
      remountOnWait: true,
    })

    await expect(scrollToLoadMore(page)).resolves.toBeUndefined()
    expect(waitFor).toHaveBeenCalledOnce()
  })

  it('installs a style that makes main taller than the viewport', async () => {
    const installed: Array<{ id: string; textContent: string }> = []
    const style = { id: '', textContent: '' }
    const document = {
      addEventListener: vi.fn(),
      createElement: () => style,
      documentElement: {
        append: (node: { id: string; textContent: string }) => installed.push(node),
      },
      getElementById: () => null,
      head: null,
      readyState: 'loading',
    }
    const page = {
      addInitScript: async (script: () => void) => {
        const previous = (globalThis as { document?: unknown }).document
        Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
        try {
          script()
        } finally {
          Object.defineProperty(globalThis, 'document', { configurable: true, value: previous })
        }
      },
    }

    await forceMainScrollableBeforeHydration(page as unknown as Page)

    expect(style.id).toBe('pw-force-scrollable-main')
    expect(style.textContent).toContain('min-height: 180vh')
    expect(installed).toEqual([style])
  })
})
