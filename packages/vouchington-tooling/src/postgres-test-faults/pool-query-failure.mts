/* oxlint-disable typescript/unbound-method -- the original pool methods are captured to be re-applied with Reflect.apply */
import type pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import { once } from 'node:events'
import {
  assertFaultOptions,
  hasErrorCode,
  installProperty,
  isPlainTextConfig,
  ownsRequest,
  queryText,
  restoreProperty,
  targetsStatement,
} from './fault-support.mts'
import type { PostgresFaultOptions, PostgresFaultResult } from './fault-types.mts'
import { runPoolObservationExclusively } from './observation-queue.mts'

type PoolLease = { pool: pg.Pool; client: pg.PoolClient; active: boolean; handedOff: boolean }
const leaseContext = new AsyncLocalStorage<PoolLease>()
const failureContext = new AsyncLocalStorage<{ active: boolean }>()

/**
 * Lets the unchanged `pg.Pool#query` core execute its original SQL on an actual aborted client.
 * The statement whose text starts with `queryMarker` (for example a leading block comment naming
 * the statement) is run after a real division by zero aborts the leased transaction, so
 * PostgreSQL answers it with `25P02`.
 */
export async function withPostgresPoolQueryFailureForTest<Result>(
  queryMarker: string,
  operation: () => Promise<Result>,
  options: PostgresFaultOptions,
): Promise<PostgresFaultResult<Result>> {
  assertFaultOptions(queryMarker, options)
  const endTimeoutMs = options.endTimeoutMs ?? 5_000
  return runPoolObservationExclusively(async () => {
    const context = { active: true }
    let fired = false
    let targetError: Error | undefined
    let cleanupFailure: Error | undefined
    const originals = options.pools.map((pool) => ({
      pool,
      query: pool.query,
      connect: pool.connect,
      queryDescriptor: Object.getOwnPropertyDescriptor(pool, 'query'),
      connectDescriptor: Object.getOwnPropertyDescriptor(pool, 'connect'),
    }))
    function requireFailure(result: Result): PostgresFaultResult<Result> {
      if (cleanupFailure) throw cleanupFailure
      if (!targetError) throw new Error('The operation did not execute the targeted failed SQL')
      return { result, error: targetError }
    }

    async function executeFault(
      pool: pg.Pool,
      query: pg.Pool['query'],
      connect: pg.Pool['connect'],
      args: unknown[],
    ): Promise<unknown> {
      const client = await (Reflect.apply(connect, pool, []) as Promise<pg.PoolClient>)
      const lease: PoolLease = { pool, client, active: true, handedOff: false }
      // Register before release: pg-pool destroys errored clients without awaiting their end.
      const ended = once(client, 'end', { signal: AbortSignal.timeout(endTimeoutMs) })
      // Observe rejection immediately even if SQL fails before cleanup awaits this promise.
      const settledEnd = ended.then(
        () => undefined,
        (err: unknown) => err,
      )
      let result: unknown
      let failure: unknown
      try {
        // The lease transfers release to the unchanged pg-pool core; destroying that client owns rollback.
        await client.query('BEGIN')
        try {
          await client.query('/* withPostgresPoolQueryFailureForTest */ SELECT 1 / 0')
          throw new Error('PostgreSQL unexpectedly accepted division by zero')
        } catch (err) {
          if (!hasErrorCode(err, '22012')) throw err
        }
        try {
          result = await leaseContext.run(
            lease,
            () => Reflect.apply(query, pool, args) as Promise<unknown>,
          )
        } catch (err) {
          if (!hasErrorCode(err, '25P02')) throw err
          if (!lease.handedOff)
            throw new Error('The original pool core did not acquire the lease', { cause: err })
          targetError = err
          throw err
        }
      } catch (err) {
        failure = err
      } finally {
        lease.active = false
        if (!lease.handedOff) client.release(true)
      }
      const endError = await settledEnd
      if (endError) {
        cleanupFailure = new AggregateError(
          [endError, failure],
          'The failed pool client did not finish closing',
        )
        throw cleanupFailure
      }
      if (failure instanceof Error) throw failure
      if (failure)
        throw new Error('Pool query failed with a non-Error rejection', { cause: failure })
      return result
    }

    function wrapPoolQuery(
      pool: pg.Pool,
      query: pg.Pool['query'],
      connect: pg.Pool['connect'],
    ): pg.Pool['query'] {
      return ((...args: unknown[]) => {
        const text = queryText(args[0])
        const ownsContext = failureContext.getStore() === context || ownsRequest(options)
        if (
          !ownsContext ||
          !context.active ||
          fired ||
          !targetsStatement(text, queryMarker, options.command)
        )
          return Reflect.apply(query, pool, args)
        if (!isPlainTextConfig(args))
          throw new Error('Target fault requires the adapter plain-config Promise pool query')
        fired = true
        return executeFault(pool, query, connect, args)
      }) as pg.Pool['query']
    }

    function wrapPoolConnect(pool: pg.Pool, connect: pg.Pool['connect']): pg.Pool['connect'] {
      return ((...args: unknown[]) => {
        const lease = leaseContext.getStore()
        if (
          lease?.active &&
          lease.pool === pool &&
          !lease.handedOff &&
          args.length === 1 &&
          typeof args[0] === 'function'
        ) {
          const callback = args[0] as (
            err: null,
            client: pg.PoolClient,
            release: pg.PoolClient['release'],
          ) => void
          queueMicrotask(() => {
            if (!lease.active) return
            lease.handedOff = true
            callback(null, lease.client, lease.client.release)
          })
          return undefined
        }
        return Reflect.apply(connect, pool, args)
      }) as pg.Pool['connect']
    }

    try {
      for (const { pool, query, connect } of originals) {
        installProperty(pool, 'connect', wrapPoolConnect(pool, connect))
        installProperty(pool, 'query', wrapPoolQuery(pool, query, connect))
      }
      return await failureContext.run(context, async () => requireFailure(await operation()))
    } finally {
      context.active = false
      for (const { pool, queryDescriptor, connectDescriptor } of originals) {
        restoreProperty(pool, 'query', queryDescriptor)
        restoreProperty(pool, 'connect', connectDescriptor)
      }
    }
  })
}
