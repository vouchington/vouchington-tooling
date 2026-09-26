const AUDIT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

type SignalListener = () => void

export interface AuditSignalDependencies {
  readonly raiseSignal?: (signal: NodeJS.Signals) => void
  readonly subscribe?: (signal: NodeJS.Signals, listener: SignalListener) => void
  readonly unsubscribe?: (signal: NodeJS.Signals, listener: SignalListener) => void
}

/**
 * Runs an audit while SIGINT, SIGTERM, and SIGHUP abort it, remove its workspace, and are raised
 * again so the process still exits from that signal.
 */
export async function withAuditSignalCleanup<T>(
  cleanup: () => void,
  run: (signal: AbortSignal) => Promise<T>,
  dependencies: AuditSignalDependencies = {},
): Promise<T> {
  const controller = new AbortController()
  let raised: NodeJS.Signals | undefined
  const handlers = AUDIT_SIGNALS.map((signal) => {
    const listener = () => {
      if (raised !== undefined) return
      raised = signal
      controller.abort(signal)
    }
    if (dependencies.subscribe) dependencies.subscribe(signal, listener)
    else process.on(signal, listener)
    return { listener, signal }
  })
  try {
    return await run(controller.signal)
  } finally {
    for (const { listener, signal } of handlers) {
      if (dependencies.unsubscribe) dependencies.unsubscribe(signal, listener)
      else process.removeListener(signal, listener)
    }
    try {
      cleanup()
    } finally {
      if (raised !== undefined) {
        if (dependencies.raiseSignal) dependencies.raiseSignal(raised)
        else process.kill(process.pid, raised)
      }
    }
  }
}
