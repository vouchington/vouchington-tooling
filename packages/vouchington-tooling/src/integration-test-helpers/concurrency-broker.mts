import type http from 'node:http'

export const ASSET_CONCURRENCY_PATH = '/__trace/asset-concurrency-slot'

interface Lease {
  granted: boolean
  response: http.ServerResponse
}

export interface AssetConcurrencyBroker {
  handle(path: string, response: http.ServerResponse): boolean
}

/**
 * In-process HTTP concurrency broker that grants up to `limit` streaming response leases on `path`
 * and hands the slot to the next queued waiter when a client cancels or closes its stream.
 */
export function createAssetConcurrencyBroker(
  limit: number,
  path: string = ASSET_CONCURRENCY_PATH,
): AssetConcurrencyBroker {
  const waiting: Lease[] = []
  let active = 0

  function grant(lease: Lease): void {
    lease.granted = true
    active++
    lease.response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/octet-stream',
    })
    lease.response.write('granted')
  }

  function grantNext(): void {
    let lease = waiting.shift()
    while (lease?.response.destroyed) lease = waiting.shift()
    if (lease) grant(lease)
  }

  return {
    handle(requestPath: string, response: http.ServerResponse): boolean {
      if (requestPath !== path) return false
      const lease: Lease = { granted: false, response }
      response.once('close', () => {
        if (lease.granted) {
          active--
          grantNext()
          return
        }
        const index = waiting.indexOf(lease)
        if (index >= 0) waiting.splice(index, 1)
      })
      if (active < limit) grant(lease)
      else waiting.push(lease)
      return true
    },
  }
}

export interface CrossProcessConcurrencyLimiterOptions {
  path?: string
  timeoutMs?: number
}

/** Acquires a streaming concurrency lease from an HTTP broker before running `fn`. */
export function createCrossProcessConcurrencyLimiter(
  origin: string,
  options: CrossProcessConcurrencyLimiterOptions = {},
) {
  const slotUrl = new URL(options.path ?? ASSET_CONCURRENCY_PATH, origin)
  const timeoutMs = options.timeoutMs ?? 60_000

  return async function runWithConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
    const lease = await fetch(slotUrl, { signal: AbortSignal.timeout(timeoutMs) })
    if (!lease.ok) {
      await lease.body?.cancel()
      throw new Error(`asset concurrency broker returned ${lease.status}`)
    }
    try {
      return await fn()
    } finally {
      await lease.body?.cancel()
    }
  }
}
