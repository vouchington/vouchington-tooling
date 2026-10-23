/** Runs `handler` once if `signal` aborts; the returned function detaches it. */
export function onAbort(signal: AbortSignal | null | undefined, handler: () => void): () => void {
  signal?.addEventListener('abort', handler, { once: true })
  return () => signal?.removeEventListener('abort', handler)
}

/** Reads the request body, rejecting with the signal's reason if it aborts before the body ends. */
export async function readUntilAborted(request: Request, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  let detach!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    detach = onAbort(signal, () => reject(signal.reason as Error))
  })
  try {
    return Buffer.from(await Promise.race([request.arrayBuffer(), aborted]))
  } finally {
    detach()
  }
}
