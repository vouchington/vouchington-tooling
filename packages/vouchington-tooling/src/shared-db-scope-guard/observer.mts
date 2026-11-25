import type {
  SharedDbKeysetRead,
  SharedDbScopeObserver,
} from '@vouchington/postgres/query-telemetry'

type ObserverHost = Record<symbol, unknown>

/**
 * Installs a test-only shared-DB scope observer under `Symbol.for(observerKey)` and returns an
 * idempotent disposer that restores the prior observer if this one is still active.
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
  const host = globalThis as unknown as ObserverHost
  const previous = host[symbol]
  host[symbol] = observer
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (host[symbol] === observer) host[symbol] = previous
  }
}
