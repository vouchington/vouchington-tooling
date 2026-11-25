import type {
  SharedDbKeysetRead,
  SharedDbScopeObserver,
} from '@vouchington/postgres/query-telemetry'

type ObserverHost = Record<symbol, unknown>

interface ObserverStackEntry {
  wrapped: unknown
  active: boolean
}

interface ObserverStack {
  base: unknown
  entries: ObserverStackEntry[]
}

/**
 * Installs a test-only shared-DB scope observer under `Symbol.for(observerKey)` and returns an
 * idempotent disposer. Tracks active installations so disposing out of order never resurrects a
 * disposed observer and installing the same callback twice keeps each installation distinct.
 */
export function installSharedDbScopeObserver<
  Operation extends string = string,
  Table extends string = string,
  KeysetRead extends SharedDbKeysetRead = SharedDbKeysetRead,
>(observerKey: string, observer: SharedDbScopeObserver<Operation, Table, KeysetRead>): () => void {
  if (observerKey.trim().length === 0) {
    throw new RangeError('Shared DB scope observer key must be a non-empty string')
  }
  const symbol = Symbol.for(observerKey)
  const stackSymbol = Symbol.for(`${observerKey}.__stack__`)
  const host = globalThis as unknown as ObserverHost
  let stack = host[stackSymbol] as ObserverStack | undefined
  if (!stack) {
    stack = { base: host[symbol], entries: [] }
    host[stackSymbol] = stack
  }
  const wrapped: SharedDbScopeObserver<Operation, Table, KeysetRead> = observer.bind(undefined)
  const entry: ObserverStackEntry = { wrapped, active: true }
  stack.entries.push(entry)
  host[symbol] = wrapped

  return () => {
    if (!entry.active) return
    entry.active = false
    const index = stack.entries.indexOf(entry)
    const isTop = index === stack.entries.length - 1
    stack.entries.splice(index, 1)
    if (isTop && host[symbol] === wrapped) {
      const next = stack.entries.at(-1)
      host[symbol] = next ? next.wrapped : stack.base
    }
    if (stack.entries.length === 0) {
      Reflect.deleteProperty(host, stackSymbol)
    }
  }
}
