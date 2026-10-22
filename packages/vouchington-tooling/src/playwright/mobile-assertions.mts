import { expect, type Page } from '@playwright/test'

export interface HorizontalOverflowState {
  overflow: boolean
  scrollWidth: number
  clientWidth: number
  offenders: Array<{ tag: string; id: string; cls: string; right: number }>
}

type OverflowElement = {
  tagName: string
  id: string
  getAttribute: (name: string) => string | null
  getBoundingClientRect: () => { right: number }
}

type OverflowDocument = {
  documentElement: { scrollWidth: number; clientWidth: number }
  querySelectorAll: (selector: string) => Iterable<OverflowElement>
}

export function getHorizontalOverflowState(): HorizontalOverflowState {
  const root = (globalThis as typeof globalThis & { document: OverflowDocument }).document
  const scrollWidth = root.documentElement.scrollWidth
  const clientWidth = root.documentElement.clientWidth
  if (scrollWidth <= clientWidth) {
    return { overflow: false, scrollWidth, clientWidth, offenders: [] }
  }

  const offenders: HorizontalOverflowState['offenders'] = []
  for (const element of root.querySelectorAll('*')) {
    const rect = element.getBoundingClientRect()
    if (rect.right > clientWidth + 1) {
      offenders.push({
        tag: element.tagName,
        id: element.id,
        cls: (element.getAttribute('class') ?? '').slice(0, 60),
        right: Math.round(rect.right),
      })
    }
  }
  return { overflow: true, scrollWidth, clientWidth, offenders: offenders.slice(0, 10) }
}

export async function assertNoHorizontalScroll(page: Page): Promise<void> {
  // Poll until layout settles — CSS transitions like
  // sidebar collapse may briefly cause scrollWidth > clientWidth.
  const state: { lastResult: HorizontalOverflowState | null } = { lastResult: null }

  try {
    await expect
      .poll(
        async () => {
          state.lastResult = await page.evaluate(getHorizontalOverflowState)
          return state.lastResult.overflow
        },
        { timeout: 5000, intervals: [50, 100] },
      )
      .toBe(false)
  } catch (err) {
    // Log only once after all retries are exhausted
    const { lastResult } = state
    if (lastResult?.overflow) {
      console.error(
        `Horizontal overflow detected: scrollWidth=${lastResult.scrollWidth} clientWidth=${lastResult.clientWidth}\nOffending elements:`,
        JSON.stringify(lastResult.offenders, null, 2),
      )
    }
    throw err
  }
}
