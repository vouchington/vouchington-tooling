import type { EventEmitter } from 'node:events'
import type pg from 'pg'
import { configureNoticeSession, restoreNoticeSession } from './lock-notice-session.mts'
import type { LockNoticeOptions, Settings } from './lock-notice-session.mts'

export type { LockNoticeOptions } from './lock-notice-session.mts'

export type LockNoticeClient = Pick<pg.PoolClient, 'query'> & Pick<EventEmitter, 'on' | 'off'>
export type LockNoticeObservation = ReturnType<typeof observePostgresLockNotice>

/**
 * Observes one real reserved connection. PostgreSQL emits the `log_lock_waits` LOG while the lock
 * is still blocked; `wait` resolves on the exact notice for `lockTag` and `mode`. `ready` applies
 * session settings that `close` restores.
 */
export function observePostgresLockNotice(
  client: LockNoticeClient,
  lockTag: string,
  mode: string,
  options: LockNoticeOptions = {},
) {
  const eligible = options.eligible ?? (() => true)
  const noticed = Promise.withResolvers<void>()
  let processId: number | undefined
  let original: Settings | undefined
  let closing: Promise<void> | undefined
  const applicationName = `${options.applicationNamePrefix ?? 'lock-notice'}-${crypto.randomUUID()}`
  const notice = (event: { message?: string }) => {
    if (
      eligible() &&
      processId !== undefined &&
      event.message?.startsWith(
        `process ${processId} still waiting for ${mode} on ${lockTag} after `,
      )
    )
      noticed.resolve()
  }
  client.on('notice', notice)
  const ready = Promise.resolve().then(async () => {
    const session = await configureNoticeSession(client, applicationName, options, (settings) => {
      original = settings
    })
    processId = session.processId
    return session
  })
  return {
    ready,
    async wait(settled: Promise<PromiseSettledResult<unknown>[]>) {
      await ready
      await Promise.race([
        noticed.promise,
        settled.then(([result]) => {
          if (result?.status === 'rejected') {
            const failure = Promise.withResolvers<never>()
            failure.reject(result.reason)
            return failure.promise
          }
          throw new Error('Owned action settled without reaching its lock')
        }),
      ])
    },
    close() {
      return (closing ??= (async () => {
        await Promise.allSettled([ready])
        client.off('notice', notice)
        if (original) await restoreNoticeSession(client, original)
      })())
    },
  }
}

/** Observes a blocked `pg_advisory_lock` (exclusive) or `pg_advisory_lock_shared` waiter. */
export function observeTestAdvisoryLockNotice(
  client: LockNoticeClient,
  lockTag: string,
  options: LockNoticeOptions & { mode?: 'exclusive' | 'shared' } = {},
) {
  return observePostgresLockNotice(
    client,
    lockTag,
    options.mode === 'shared' ? 'ShareLock' : 'ExclusiveLock',
    options,
  )
}

/** Observes a waiter blocked on another transaction's id, for example a row-lock conflict. */
export function observeTestTransactionLockNotice(
  client: LockNoticeClient,
  transactionId: string,
  options: LockNoticeOptions = {},
) {
  return observePostgresLockNotice(client, `transaction ${transactionId}`, 'ShareLock', options)
}
