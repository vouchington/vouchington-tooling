import type { Page } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertNoHorizontalScroll,
  getHorizontalOverflowState,
  type HorizontalOverflowState,
} from './mobile-assertions.mts'

interface FakeElement {
  tagName: string
  id: string
  className: string | { baseVal: string }
  getAttribute: (name: string) => string | null
  getBoundingClientRect: () => { right: number }
}

const pollOptions = vi.hoisted(() => ({
  mode: 'compare' as 'compare' | 'always-throw',
  current: null as { timeout: number; intervals: number[] } | null,
}))

vi.mock('@playwright/test', () => ({
  expect: {
    poll: (callback: () => Promise<boolean>, options: { timeout: number; intervals: number[] }) => {
      pollOptions.current = options
      return {
        toBe: async (expected: boolean) => {
          const value = await callback()
          if (pollOptions.mode === 'always-throw' || value !== expected) {
            throw new Error(`poll mismatch: ${String(value)}`)
          }
        },
      }
    },
  },
}))

function installDocument(
  scrollWidth: number,
  clientWidth: number,
  elements: FakeElement[] = [],
): void {
  vi.stubGlobal('document', {
    documentElement: { scrollWidth, clientWidth },
    querySelectorAll: () => elements,
  })
}

function pageReturning(state: HorizontalOverflowState | Error): Page {
  return {
    evaluate: vi.fn(async () => {
      if (state instanceof Error) throw state
      return state
    }),
  } as unknown as Page
}

describe('getHorizontalOverflowState', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    pollOptions.mode = 'compare'
    pollOptions.current = null
  })

  it('reports no overflow when document width fits the viewport', () => {
    installDocument(320, 320)

    expect(getHorizontalOverflowState()).toEqual({
      overflow: false,
      scrollWidth: 320,
      clientWidth: 320,
      offenders: [],
    })
  })

  it('reports overflow without offenders when no element extends past the viewport', () => {
    installDocument(321, 320, [
      {
        tagName: 'DIV',
        id: 'within-viewport',
        className: 'content',
        getAttribute: () => 'content',
        getBoundingClientRect: () => ({ right: 321 }),
      },
    ])

    expect(getHorizontalOverflowState()).toEqual({
      overflow: true,
      scrollWidth: 321,
      clientWidth: 320,
      offenders: [],
    })
  })

  it('reports overflowing elements as offenders', () => {
    installDocument(500, 320, [
      {
        tagName: 'SECTION',
        id: 'offender',
        className: 'x'.repeat(61),
        getAttribute: () => 'x'.repeat(61),
        getBoundingClientRect: () => ({ right: 322.4 }),
      },
    ])

    expect(getHorizontalOverflowState()).toEqual({
      overflow: true,
      scrollWidth: 500,
      clientWidth: 320,
      offenders: [{ tag: 'SECTION', id: 'offender', cls: 'x'.repeat(60), right: 322 }],
    })
  })

  it.each(['icon', null])(
    'reads SVG class attributes (%s) without stringifying className',
    (cls) => {
      installDocument(500, 320, [
        {
          tagName: 'svg',
          id: 'svg-offender',
          className: { baseVal: cls ?? '' },
          getAttribute: () => cls,
          getBoundingClientRect: () => ({ right: 400 }),
        },
      ])
      expect(getHorizontalOverflowState().offenders).toEqual([
        { tag: 'svg', id: 'svg-offender', cls: cls ?? '', right: 400 },
      ])
    },
  )
})

describe('assertNoHorizontalScroll', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    pollOptions.mode = 'compare'
    pollOptions.current = null
  })

  it('resolves when the polled layout fits', async () => {
    const page = pageReturning({
      overflow: false,
      scrollWidth: 320,
      clientWidth: 320,
      offenders: [],
    })

    await assertNoHorizontalScroll(page)

    expect(pollOptions.current).toEqual({ timeout: 5000, intervals: [50, 100] })
  })

  it('logs offenders when the layout still overflows', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const page = pageReturning({
      overflow: true,
      scrollWidth: 500,
      clientWidth: 320,
      offenders: [{ tag: 'DIV', id: 'wide', cls: 'wide', right: 500 }],
    })

    await expect(assertNoHorizontalScroll(page)).rejects.toThrow('poll mismatch: true')
    expect(error).toHaveBeenCalledWith(
      'Horizontal overflow detected: scrollWidth=500 clientWidth=320\nOffending elements:',
      JSON.stringify([{ tag: 'DIV', id: 'wide', cls: 'wide', right: 500 }], null, 2),
    )
  })

  it('rethrows without logging when the poll fails before a measurement', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const page = pageReturning(new Error('evaluate failed'))

    await expect(assertNoHorizontalScroll(page)).rejects.toThrow('evaluate failed')
    expect(error).not.toHaveBeenCalled()
  })

  it('rethrows without logging when the last measurement fits', async () => {
    pollOptions.mode = 'always-throw'
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const page = pageReturning({
      overflow: false,
      scrollWidth: 320,
      clientWidth: 320,
      offenders: [],
    })

    await expect(assertNoHorizontalScroll(page)).rejects.toThrow('poll mismatch: false')
    expect(error).not.toHaveBeenCalled()
  })
})
