type AwsAbortSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  onabort?: ((event?: Event) => void) | null | undefined
  addEventListener?: AbortSignal['addEventListener']
  removeEventListener?: AbortSignal['removeEventListener']
}

function assertAwsAbortSignal(source: NonNullable<unknown>): asserts source is AwsAbortSignal {
  if (typeof source !== 'object' || !('aborted' in source) || typeof source.aborted !== 'boolean')
    throw new TypeError('Invalid AWS request abort signal')
}

/** Smithy accepts native, cross-realm EventTarget, and legacy onabort signals. */
export function observeAwsReplayAbort(source: unknown): {
  signal: AbortSignal | undefined
  detach: () => void
} {
  if (source == null) return { signal: undefined, detach: () => {} }
  if (source instanceof AbortSignal) return { signal: source, detach: () => {} }
  assertAwsAbortSignal(source)

  const controller = new AbortController()
  const abort = () => controller.abort(source.reason)
  if (source.aborted) {
    abort()
    return { signal: controller.signal, detach: () => {} }
  }

  let detach: () => void
  if (
    typeof source.addEventListener === 'function' &&
    typeof source.removeEventListener === 'function'
  ) {
    source.addEventListener('abort', abort, { once: true })
    detach = () => source.removeEventListener!('abort', abort)
  } else if ('onabort' in source) {
    detach = observeLegacyAbort(source, abort)
  } else throw new TypeError('AWS request abort signal has no notification API')

  // Cancellation can race with installing the observer.
  if (source.aborted) abort()
  return { signal: controller.signal, detach }
}

type LegacyAbortObservers = {
  callbacks: Set<() => void>
  previous: AwsAbortSignal['onabort']
  listener: (event?: Event) => void
}
const legacyObservers = new WeakMap<AwsAbortSignal, LegacyAbortObservers>()

function legacyState(source: AwsAbortSignal): LegacyAbortObservers {
  const existing = legacyObservers.get(source)
  if (existing && source.onabort === existing.listener) return existing
  const previous = source.onabort
  const callbacks = new Set<() => void>()
  const listener = (event?: Event) => {
    for (const callback of callbacks) callback()
    previous?.call(source, event)
  }
  const state = { callbacks, previous, listener }
  legacyObservers.set(source, state)
  source.onabort = listener
  return state
}

function observeLegacyAbort(source: AwsAbortSignal, abort: () => void): () => void {
  const observed = legacyState(source)
  observed.callbacks.add(abort)
  return () => {
    observed.callbacks.delete(abort)
    if (observed.callbacks.size > 0) return
    if (source.onabort === observed.listener) source.onabort = observed.previous
    if (legacyObservers.get(source) === observed) legacyObservers.delete(source)
  }
}
