import { beforeEach, describe, expect, it } from 'vitest'

import { createNavMock, navMockModule } from './index.mts'

describe('next-navigation-mock', () => {
  const nav = createNavMock()

  beforeEach(() => nav.reset())

  it('starts with empty state', () => {
    expect(navMockModule.useSearchParams().toString()).toBe('')
    expect(navMockModule.usePathname()).toBe('/')
    expect(navMockModule.useParams()).toEqual({})
  })

  it('serves state set through the control object', () => {
    nav.setSearchParams('q=hello')
    nav.setPathname('/search')
    nav.setParams({ id: '7', rest: ['a', 'b'] })
    expect(navMockModule.useSearchParams().get('q')).toBe('hello')
    expect(navMockModule.usePathname()).toBe('/search')
    expect(navMockModule.useParams()).toEqual({ id: '7', rest: ['a', 'b'] })
  })

  it('copies URLSearchParams and clears on undefined', () => {
    const source = new URLSearchParams('a=1')
    nav.setSearchParams(source)
    expect(navMockModule.useSearchParams()).not.toBe(source)
    expect(navMockModule.useSearchParams().get('a')).toBe('1')
    nav.setSearchParams()
    expect(navMockModule.useSearchParams().toString()).toBe('')
  })

  it('shares spies and state across createNavMock calls', () => {
    const other = createNavMock()
    expect(other.push).toBe(nav.push)
    navMockModule.useRouter().push('/x', { scroll: false })
    expect(other.push).toHaveBeenCalledWith('/x', { scroll: false })
    other.setPathname('/shared')
    expect(navMockModule.usePathname()).toBe('/shared')
  })

  it('exposes every router spy and resets their history', () => {
    const router = navMockModule.useRouter()
    for (const name of ['push', 'replace', 'refresh', 'back', 'forward', 'prefetch'] as const) {
      expect(router[name]).toBe(nav[name])
      router[name]('/a')
      expect(nav[name]).toHaveBeenCalledTimes(1)
    }
    nav.setPathname('/changed')
    nav.reset()
    expect(nav.push).not.toHaveBeenCalled()
    expect(navMockModule.usePathname()).toBe('/')
  })
})
