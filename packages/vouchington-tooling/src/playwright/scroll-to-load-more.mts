import type { Page } from '@playwright/test'
import { waitForBelowFoldHydration } from './wait-for-hydration.mts'

const SENTINEL_TEST_ID = 'infinite-scroll-sentinel'
const MAX_SCROLL_ATTEMPTS = 30
const POST_HYDRATION_SCROLL_RETRIES = 3
const BOUNDING_BOX_TIMEOUT_MS = 2_000
const SCROLL_LOOP_BUDGET_MS = 10_000
const DETACHED_REMOUNT_WAIT_MS = 1_000

type AttemptState = 'detached' | 'race-detach' | 'no-box' | 'below-fold'

function readScrollTop(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          document: { scrollingElement: { scrollTop: number } | null }
        }
      ).document.scrollingElement?.scrollTop ?? 0,
  )
}

/**
 * Trigger pagination with a real scroll gesture.
 *
 * The pagination control gates `onLoadMore` behind a one-shot window `scroll`
 * listener plus IntersectionObserver, so this wheels a viewport at a time
 * until the sentinel is on screen. Do not use `scrollIntoViewIfNeeded()`:
 * it is a no-op on an already-visible element and emits no `scroll` event
 * (`playwright-no-scroll-into-view-sentinel`).
 *
 * After the sentinel is in view, wait for below-fold hydration and issue a
 * net-zero extra scroll so a deferred listener still sees a live event.
 *
 * Probe `count()` before `boundingBox()` and bound `boundingBox()` to
 * {@link BOUNDING_BOX_TIMEOUT_MS} so a detached sentinel cannot consume the
 * action timeout. The loop is also bounded by
 * {@link SCROLL_LOOP_BUDGET_MS}; a detached attempt waits up to
 * {@link DETACHED_REMOUNT_WAIT_MS} for remount.
 *
 * The pagination control unmounts the sentinel when `hasNextPage` becomes false.
 * If this helper already saw the sentinel attached (typically below the fold)
 * and it stays gone after that remount wait, pagination already loaded the
 * last page. Treating that as failure flakes the scroll-gated specs.
 */
export async function scrollToLoadMore(
  page: Page,
  { sentinelTestId = SENTINEL_TEST_ID }: { sentinelTestId?: string } = {},
): Promise<void> {
  const sentinel = page.getByTestId(sentinelTestId)
  const viewport = page.viewportSize()
  const centerX = (viewport?.width ?? 0) / 2
  const viewportHeight = viewport?.height ?? 0

  await page.mouse.move(centerX, viewportHeight / 2)

  let sentinelInView = false
  let lastPageConsumedSentinel = false
  let sawSentinelAttached = false
  let lastCount = 0
  let lastBox: Awaited<ReturnType<typeof sentinel.boundingBox>> = null
  const initialScrollTop = await readScrollTop(page)
  const scrollTops: number[] = [initialScrollTop]
  const attemptStates: AttemptState[] = []
  const loopDeadline = Date.now() + SCROLL_LOOP_BUDGET_MS
  for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS && Date.now() < loopDeadline; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- count() must resolve before deciding whether to probe further
    lastCount = await sentinel.count()
    if (lastCount > 0) {
      sawSentinelAttached = true
      let boundingBoxTimedOut = false
      // oxlint-disable-next-line no-await-in-loop -- bounded so a count()/boundingBox() detach race can't consume the full action timeout
      lastBox = await sentinel.boundingBox({ timeout: BOUNDING_BOX_TIMEOUT_MS }).catch(() => {
        boundingBoxTimedOut = true
        return null
      })
      if (lastBox && lastBox.y < viewportHeight) {
        sentinelInView = true
        break
      }
      attemptStates.push(lastBox ? 'below-fold' : boundingBoxTimedOut ? 'race-detach' : 'no-box')
    } else {
      lastBox = null
      attemptStates.push('detached')
      // oxlint-disable-next-line no-await-in-loop -- bounded wait gives a transient detach real time to remount
      await sentinel
        .waitFor({ state: 'attached', timeout: DETACHED_REMOUNT_WAIT_MS })
        .catch(() => undefined)
      // oxlint-disable-next-line no-await-in-loop -- remount vs last-page unmount must be distinguished before wheeling
      lastCount = await sentinel.count()
      if (lastCount > 0) continue
      if (sawSentinelAttached) {
        lastPageConsumedSentinel = true
        break
      }
    }
    // oxlint-disable-next-line no-await-in-loop -- scrolling all at once would overshoot the sentinel
    await page.mouse.wheel(0, viewportHeight)
    // oxlint-disable-next-line no-await-in-loop -- records this attempt's post-wheel position for diagnosis
    scrollTops.push(await readScrollTop(page))
  }

  if (!sentinelInView && !lastPageConsumedSentinel) {
    const documentState = await page.evaluate(() => ({
      scrollHeight: (
        globalThis as typeof globalThis & {
          document: { documentElement: { scrollHeight: number } }
        }
      ).document.documentElement.scrollHeight,
      innerHeight: (globalThis as typeof globalThis & { window: { innerHeight: number } }).window
        .innerHeight,
    }))
    const documentScrolled = scrollTops.at(-1)! > initialScrollTop
    const tally: Record<AttemptState, number> = {
      detached: 0,
      'race-detach': 0,
      'no-box': 0,
      'below-fold': 0,
    }
    for (const s of attemptStates) tally[s] += 1
    const state = !documentScrolled
      ? `the document never scrolled despite ${attemptStates.length} wheel events ` +
        `(scrollTop stayed at ${initialScrollTop}) — the wheel target may have landed on a ` +
        `nested scroll container instead of the document`
      : tally.detached === attemptStates.length
        ? `sentinel was detached from the DOM on every attempt (count()=0 all ` +
          `${attemptStates.length} times) — it never (re)mounted during the scroll loop`
        : `sentinel state varied across ${attemptStates.length} attempts: ` +
          `${tally.detached} detached, ${tally['race-detach']} attached-but-boundingBox-timed-out, ` +
          `${tally['no-box']} attached-but-invisible, ${tally['below-fold']} below-fold`
    throw new Error(
      `scrollToLoadMore: sentinel [data-testid="${sentinelTestId}"] did not enter the ` +
        `viewport after ${attemptStates.length} scroll attempts: ${state}. ` +
        `lastCount()=${lastCount}, lastBox=${JSON.stringify(lastBox)}, ` +
        `scrollTop=${scrollTops[0]}->${scrollTops.at(-1)}, ` +
        `documentScrollHeight=${documentState.scrollHeight}, windowInnerHeight=${documentState.innerHeight}`,
    )
  }

  if (!sentinelInView) return

  for (let retry = 0; retry < POST_HYDRATION_SCROLL_RETRIES; retry++) {
    // oxlint-disable-next-line no-await-in-loop -- each retry must wait for hydration to catch up first
    await waitForBelowFoldHydration(page)
    // oxlint-disable-next-line no-await-in-loop -- must complete before the wheel-forward below
    await page.mouse.wheel(0, -50)
    // oxlint-disable-next-line no-await-in-loop -- closes the net-zero scroll pair for this retry
    await page.mouse.wheel(0, 50)
  }
}

/**
 * Force `main` to exceed the viewport height before hydration, so
 * the pagination control's short-page escape hatch (which auto-loads when
 * `document.documentElement.scrollHeight <= window.innerHeight`) cannot open
 * the pagination gate on its own. Use this alongside `scrollToLoadMore(page)`
 * so a scroll-triggered pagination test exercises the scroll-gated path
 * deterministically rather than depending on whichever seeded content happens
 * to render.
 */
export async function forceMainScrollableBeforeHydration(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const styleId = 'pw-force-scrollable-main'
    const document = (
      globalThis as typeof globalThis & {
        document: {
          addEventListener: (type: string, listener: () => void, options: { once: boolean }) => void
          createElement: (tag: string) => { id: string; textContent: string }
          documentElement: { append: (node: unknown) => void } | null
          getElementById: (id: string) => unknown
          head: { append: (node: unknown) => void } | null
          readyState: string
        }
      }
    ).document

    const installStyle = () => {
      if (document.getElementById(styleId)) return
      const styleRoot = document.head ?? document.documentElement
      if (!styleRoot) return

      const style = document.createElement('style')
      style.id = styleId
      style.textContent = 'main { min-height: 180vh !important; }'
      styleRoot.append(style)
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', installStyle, { once: true })
    }
    installStyle()
  })
}
