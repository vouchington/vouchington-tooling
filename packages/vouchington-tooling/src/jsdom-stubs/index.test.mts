import { describe, expect, it } from 'vitest'

import { createMemoryStorage, installJsdomStubs, installMemoryLocalStorage } from './index.mts'

function fakeWindow(overrides: Record<string, unknown> = {}) {
  return { HTMLElement: { prototype: {} }, ...overrides } as Record<string, unknown>
}

describe('createMemoryStorage', () => {
  it('implements the Storage contract', () => {
    const storage = createMemoryStorage()
    expect(storage.getItem('a')).toBeNull()
    storage.setItem('a', '1')
    storage.setItem('b', '2')
    expect(storage.getItem('a')).toBe('1')
    expect(storage.length).toBe(2)
    expect(storage.key(1)).toBe('b')
    expect(storage.key(5)).toBeNull()
    storage.removeItem('a')
    expect(storage.length).toBe(1)
    storage.clear()
    expect(storage.length).toBe(0)
  })
})

describe('installMemoryLocalStorage', () => {
  it('installs one store on the target and its window', () => {
    const win = fakeWindow()
    const target = { window: win }
    const storage = installMemoryLocalStorage(target)
    expect((target as Record<string, unknown>).localStorage).toBe(storage)
    expect(win.localStorage).toBe(storage)
  })

  it('handles a target without a window and a self-referential window', () => {
    const bare = {}
    const storage = installMemoryLocalStorage(bare)
    expect((bare as Record<string, unknown>).localStorage).toBe(storage)
    const self: Record<string, unknown> = {}
    self.window = self
    expect(installMemoryLocalStorage(self)).toBe(self.localStorage)
  })

  it('defaults to globalThis', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    try {
      const storage = installMemoryLocalStorage()
      expect(globalThis.localStorage).toBe(storage)
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })
})

describe('installJsdomStubs', () => {
  it('installs every missing stub', () => {
    const win = fakeWindow()
    const target: Record<string, unknown> = { window: win }
    installJsdomStubs(target)
    const observer = new (target.ResizeObserver as new () => { observe: () => void })()
    expect(observer.observe()).toBeUndefined()
    const io = new (target.IntersectionObserver as new () => { takeRecords: () => unknown[] })()
    expect(io.takeRecords()).toEqual([])
    const mql = (win.matchMedia as (query: string) => Record<string, unknown>)('(min-width: 1px)')
    expect(mql).toMatchObject({ matches: false, media: '(min-width: 1px)', onchange: null })
    expect((mql.dispatchEvent as () => boolean)()).toBe(false)
    const proto = (win.HTMLElement as { prototype: Record<string, () => void> }).prototype
    expect(proto.scrollIntoView?.()).toBeUndefined()
  })

  it('keeps existing implementations', () => {
    const ResizeObserver = class {}
    const IntersectionObserver = class {}
    const matchMedia = () => ({})
    const scrollIntoView = () => {}
    const win = fakeWindow({ matchMedia, HTMLElement: { prototype: { scrollIntoView } } })
    const target = { ResizeObserver, IntersectionObserver, window: win }
    installJsdomStubs(target)
    expect(target.ResizeObserver).toBe(ResizeObserver)
    expect(target.IntersectionObserver).toBe(IntersectionObserver)
    expect(win.matchMedia).toBe(matchMedia)
    expect(
      (win.HTMLElement as { prototype: Record<string, unknown> }).prototype.scrollIntoView,
    ).toBe(scrollIntoView)
  })

  it('skips window stubs when there is no window or HTMLElement', () => {
    const noWindow: Record<string, unknown> = {}
    installJsdomStubs(noWindow)
    expect(noWindow.ResizeObserver).toBeDefined()
    expect(noWindow.matchMedia).toBeUndefined()
    const noElement: Record<string, unknown> = { window: {} }
    installJsdomStubs(noElement)
    expect((noElement.window as Record<string, unknown>).matchMedia).toBeDefined()
  })

  it('defaults to globalThis without overwriting present globals', () => {
    const scope = Object(globalThis) as Record<string, unknown>
    const before = scope.ResizeObserver
    installJsdomStubs()
    if (before !== undefined) expect(scope.ResizeObserver).toBe(before)
    expect(scope.ResizeObserver).toBeDefined()
    expect(scope.IntersectionObserver).toBeDefined()
  })
})
