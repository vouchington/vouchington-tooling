/* oxlint-disable typescript/unbound-method -- the original pool and client methods are captured to be re-applied with Reflect.apply */
import type pg from 'pg'
import {
  observePostgresLockNotice,
  observeTestAdvisoryLockNotice,
  observeTestTransactionLockNotice,
  type LockNoticeOptions,
} from './lock-notice.mts'
import type { TestHeldPostgresLock } from './lock-identity.mts'

/**
 * Restores a real borrowed client's session settings before its synchronous `release` reaches the
 * pool. While the loan is open, `wait` resolves on the native notice for the held lock.
 */
export function createTestPostgresClientLoan(
  client: pg.PoolClient,
  lock: TestHeldPostgresLock,
  notice: LockNoticeOptions = {},
) {
  const descriptor = Object.getOwnPropertyDescriptor(client, 'release')
  const release = client.release
  const observation =
    lock.kind === 'advisory'
      ? observeTestAdvisoryLockNotice(client, lock.tag, { ...notice, mode: lock.waiterMode })
      : lock.kind === 'relation'
        ? observePostgresLockNotice(client, lock.tag, lock.waiterMode, notice)
        : observeTestTransactionLockNotice(client, lock.transactionId, notice)
  const ended = trackTestPostgresClientEnd(client)
  let requested = false
  let finishing: Promise<void> | undefined
  const restoreRelease = () => {
    if (descriptor) Object.defineProperty(client, 'release', descriptor)
    /* v8 ignore start -- pg always defines `release` as an own property of a pooled client. */ else
      Reflect.deleteProperty(client, 'release')
    /* v8 ignore stop */
  }
  function finish(receiver: pg.PoolClient, args: Parameters<pg.PoolClient['release']>) {
    return (finishing ??= (async () => {
      let restorationFailure: { reason: unknown } | undefined
      try {
        await observation.close()
      } catch (err) {
        /* v8 ignore next 2 -- only a connection lost mid-restore reaches this; the release then destroys it. */
        restorationFailure = { reason: err }
      }
      restoreRelease()
      if (restorationFailure || args[0]) {
        /* v8 ignore next -- a restoration failure is the unreachable case above. */
        Reflect.apply(release, receiver, restorationFailure ? [true] : args)
        await ended.promise
      } else {
        ended.close()
        Reflect.apply(release, receiver, args)
      }
      /* v8 ignore next -- a restoration failure is the unreachable case above. */
      if (restorationFailure) throw restorationFailure.reason
    })())
  }
  Object.defineProperty(client, 'release', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function (this: pg.PoolClient, ...args: Parameters<pg.PoolClient['release']>) {
      /* v8 ignore next -- pg itself rejects a second release before this wrapper runs twice. */
      if (requested) throw new Error('Observed PostgreSQL client was released more than once')
      requested = true
      void finish(this, args).catch(() => {})
    },
  })
  return {
    ready: observation.ready,
    wait: observation.wait,
    async dispose() {
      if (!requested) {
        requested = true
        await finish(client, [true])
      } else await finishing
    },
  }
}

export function trackTestPostgresClientEnd(client: pg.PoolClient) {
  const ended = Promise.withResolvers<void>()
  const onEnd = () => ended.resolve()
  client.once('end', onEnd)
  return { promise: ended.promise, close: () => client.off('end', onEnd) }
}

/** Destroys a client instead of returning it to the pool, and waits for its connection to end. */
export async function discardTestPostgresClient(
  client: pg.PoolClient,
  ended = trackTestPostgresClientEnd(client),
): Promise<void> {
  try {
    client.release(true)
    await ended.promise
  } finally {
    ended.close()
  }
}

/** Owns an ordinary observer checkout from `pool`, including a borrow that finishes during cleanup. */
export function reserveTestPostgresObserver(pool: pg.Pool) {
  let client: pg.PoolClient | undefined
  let ended: ReturnType<typeof trackTestPostgresClientEnd> | undefined
  let released: Promise<void> | undefined
  const ready = pool.connect().then((actual) => {
    client = actual
    ended = trackTestPostgresClientEnd(actual)
    return actual
  })
  void ready.catch(() => {})
  return {
    ready,
    get client() {
      return client
    },
    release(discard: boolean) {
      return (released ??= (async () => {
        await ready.catch(() => undefined)
        if (!client) return
        if (discard) await discardTestPostgresClient(client, ended)
        else {
          ended?.close()
          client.release()
        }
      })())
    },
  }
}
