type Target = Record<string, unknown> & { window?: Record<string, unknown> }

const noop = () => {}

class StubResizeObserver {
  observe = noop
  unobserve = noop
  disconnect = noop
}

class StubIntersectionObserver {
  observe = noop
  unobserve = noop
  disconnect = noop
  takeRecords() {
    return []
  }
}

function stubMatchMedia(query: string) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => false,
  }
}

/** In-memory `Storage`. Keep the returned object to `clear()` it between tests. */
export function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: (key) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
  }
}

function asTarget(target: object): Target {
  return target as Target
}

function define(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, { configurable: true, writable: true, value })
}

/**
 * Replaces `localStorage` on `target` (and its `window`, when present) with a fresh in-memory
 * store and returns it so the caller can clear it in `afterEach`.
 */
export function installMemoryLocalStorage(target: object = globalThis): Storage {
  const storage = createMemoryStorage()
  define(target, 'localStorage', storage)
  const win = (target as Target).window
  if (win !== undefined && win !== target) define(win, 'localStorage', storage)
  return storage
}

/**
 * Installs no-op `ResizeObserver`, `IntersectionObserver`, `matchMedia` and
 * `HTMLElement.prototype.scrollIntoView` stubs, each only when jsdom leaves it undefined.
 */
export function installJsdomStubs(target: object = globalThis): void {
  const global = asTarget(target)
  if (global.ResizeObserver === undefined) define(global, 'ResizeObserver', StubResizeObserver)
  if (global.IntersectionObserver === undefined) {
    define(global, 'IntersectionObserver', StubIntersectionObserver)
  }
  const win = global.window
  if (win === undefined) return
  if (win.matchMedia === undefined) define(win, 'matchMedia', stubMatchMedia)
  const proto = (win.HTMLElement as { prototype?: Record<string, unknown> } | undefined)?.prototype
  if (proto !== undefined && proto.scrollIntoView === undefined) {
    define(proto, 'scrollIntoView', noop)
  }
}
