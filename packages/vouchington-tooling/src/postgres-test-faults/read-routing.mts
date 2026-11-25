import { AsyncLocalStorage } from 'node:async_hooks'
import type pg from 'pg'
import { runPoolObservationExclusively } from './observation-queue.mts'

const observedRouting = new AsyncLocalStorage<symbol>()

type PoolObservation = {
  listeners: Map<symbol, () => void>
  connect: pg.Pool['connect']
  originalDescriptor: PropertyDescriptor | undefined
}

const poolObservations = new WeakMap<pg.Pool, PoolObservation>()

export interface PostgresReadRoutingObserver {
  primaryAcquisitions(): number
  replicaAcquisitions(): number
  run<T>(callback: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

/**
 * Counts successful checkouts requested inside `run` across primary and replica pools, even when
 * another caller releases a queued client. Observers share one wrapper per pool and coordinate
 * installation/removal through `runPoolObservationExclusively`.
 */
export async function observePostgresReadRoutingForTest(pools: {
  primary: pg.Pool
  replica: pg.Pool
}): Promise<PostgresReadRoutingObserver> {
  if (pools.primary === pools.replica) {
    throw new RangeError('Primary and replica pools must be distinct pg.Pool instances')
  }
  let primaryAcquisitions = 0
  let replicaAcquisitions = 0
  const token = Symbol('postgres-read-routing')
  let closed = false
  let closing: Promise<void> | undefined
  const [releasePrimary, releaseReplica] = await runPoolObservationExclusively(
    async () =>
      [
        observePoolRequests(pools.primary, token, () => {
          if (!closed) primaryAcquisitions += 1
        }),
        observePoolRequests(pools.replica, token, () => {
          if (!closed) replicaAcquisitions += 1
        }),
      ] as const,
  )

  return {
    primaryAcquisitions: () => primaryAcquisitions,
    replicaAcquisitions: () => replicaAcquisitions,
    run<T>(callback: () => Promise<T>): Promise<T> {
      return observedRouting.run(token, callback)
    },
    close() {
      closed = true
      closing ??= runPoolObservationExclusively(async () => {
        releasePrimary()
        releaseReplica()
      }).catch((err: unknown) => {
        // A rejected nested close must remain retryable after the competing instrumentation ends.
        closing = undefined
        throw err
      })
      return closing
    },
  }
}

function createPoolObservation(pool: pg.Pool): PoolObservation {
  const listeners = new Map<symbol, () => void>()
  const originalDescriptor = Object.getOwnPropertyDescriptor(pool, 'connect')
  const originalConnect = Reflect.get(pool, 'connect') as pg.Pool['connect']
  const connect = new Proxy(originalConnect, {
    apply(target, receiver, args: unknown[]) {
      const requester = observedRouting.getStore()
      const acquired = () => {
        if (requester !== undefined) listeners.get(requester)?.()
      }
      const callback = args[0]
      if (typeof callback === 'function') {
        return Reflect.apply(target, receiver, [
          function (this: unknown, ...values: unknown[]) {
            if (values[0] == null && values[1] !== undefined) acquired()
            return Reflect.apply(callback, this, values)
          },
          ...args.slice(1),
        ])
      }
      const pending = Reflect.apply(target, receiver, args) as Promise<unknown>
      return pending.then((client) => {
        acquired()
        return client
      })
    },
  })
  const observation: PoolObservation = { listeners, connect, originalDescriptor }
  Object.defineProperty(pool, 'connect', {
    configurable: true,
    enumerable: originalDescriptor?.enumerable ?? false,
    writable: true,
    value: connect,
  })
  poolObservations.set(pool, observation)
  return observation
}

function observePoolRequests(pool: pg.Pool, token: symbol, onAcquire: () => void) {
  const observation = poolObservations.get(pool) ?? createPoolObservation(pool)
  observation.listeners.set(token, onAcquire)
  return () => {
    observation.listeners.delete(token)
    if (observation.listeners.size > 0) return
    if (Reflect.get(pool, 'connect') === observation.connect) {
      if (observation.originalDescriptor) {
        Object.defineProperty(pool, 'connect', observation.originalDescriptor)
      } else {
        Reflect.deleteProperty(pool, 'connect')
      }
    }
    poolObservations.delete(pool)
  }
}
