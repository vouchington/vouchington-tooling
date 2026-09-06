export type WatchdogCleanup = () => void
type WatchdogSetup = void | WatchdogCleanup | Promise<void | WatchdogCleanup>
type WatchdogLifecycle = ReturnType<typeof createWatchdogLifecycle>

export function createWatchdogLifecycle() {
  let complete = false
  let cleanup: WatchdogCleanup | undefined
  const run = (next: WatchdogCleanup, onError: (error: unknown) => void) => {
    try {
      next()
    } catch (error) {
      onError(error)
    }
  }
  return {
    complete: (onError: (error: unknown) => void) => {
      complete = true
      if (!cleanup) return
      // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- preserve the registered cleanup before clearing mutable lifecycle state
      const next = cleanup
      cleanup = undefined
      run(next, onError)
    },
    isComplete: () => complete,
    register: (next: void | WatchdogCleanup, onError: (error: unknown) => void) => {
      if (!next) return
      if (complete) return run(next, onError)
      cleanup = next
    },
  }
}

export function registerWatchdogSetup(
  setup: WatchdogSetup,
  lifecycle: WatchdogLifecycle,
  onError: (error: unknown) => void,
): void {
  if (!(setup instanceof Promise)) return lifecycle.register(setup, onError)
  void setup.then(
    (cleanup) => lifecycle.register(cleanup, onError),
    (error) => {
      if (!lifecycle.isComplete()) onError(error)
    },
  )
}
