import { vi } from 'vitest'

type NextNavigation = typeof import('next/navigation.js')
type SearchParams = ReturnType<NextNavigation['useSearchParams']>
type SearchParamsInit = string | URLSearchParams | undefined
type RouterSpy = ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>

const state = {
  // A plain URLSearchParams at runtime; the cast only satisfies the real hook's return type.
  searchParams: new URLSearchParams() as SearchParams,
  pathname: '/',
  params: {} as Record<string, string | string[]>,
}

const push: RouterSpy = vi.fn()
const replace: RouterSpy = vi.fn()
const refresh: RouterSpy = vi.fn()
const back: RouterSpy = vi.fn()
const forward: RouterSpy = vi.fn()
const prefetch: RouterSpy = vi.fn()
const spies = [push, replace, refresh, back, forward, prefetch]
const router = { push, replace, refresh, back, forward, prefetch }

/**
 * Pass to `vi.mock('next/navigation', () => navMockModule)`. Hooks read the mutable state lazily,
 * so changes made between tests apply on the next render. Import it before the component under
 * test so the factory is initialized when the mock is evaluated.
 */
export const navMockModule = {
  useRouter: () => router,
  useSearchParams: () => state.searchParams,
  usePathname: () => state.pathname,
  useParams: () => state.params,
} as unknown as NextNavigation

/**
 * Control object for the shared `navMockModule` singleton: repeated calls share spies and state.
 * Call `reset()` in `beforeEach`.
 */
export function createNavMock() {
  return {
    push,
    replace,
    refresh,
    back,
    forward,
    prefetch,
    /** Accepts the same init forms as `new URLSearchParams()`; `undefined` clears it. */
    setSearchParams(init?: SearchParamsInit) {
      state.searchParams = new URLSearchParams(init) as SearchParams
    },
    setPathname(pathname: string) {
      state.pathname = pathname
    },
    setParams(params: Record<string, string | string[]>) {
      state.params = params
    },
    /** Restores empty search params, pathname `/`, empty params, and clears spy history. */
    reset() {
      state.searchParams = new URLSearchParams() as SearchParams
      state.pathname = '/'
      state.params = {}
      for (const spy of spies) spy.mockReset()
    },
  }
}
