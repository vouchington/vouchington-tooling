/* oxlint-disable typescript/unbound-method -- the original pool and client methods are captured to be re-applied with Reflect.apply */
import type pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
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

const queryFailureContext = new AsyncLocalStorage<{ active: boolean }>()

/**
 * Fails one actual SQL statement after its owner has begun a real transaction. The statement whose
 * text starts with `queryMarker` runs after a real division by zero aborts that transaction, so
 * PostgreSQL answers it with `25P02`. The statement must be issued on a client leased from one of
 * `options.pools`, after a `BEGIN` sent through the same client.
 */
export async function withPostgresQueryFailureForTest<Result>(
  queryMarker: string,
  operation: () => Promise<Result>,
  options: PostgresFaultOptions,
): Promise<PostgresFaultResult<Result>> {
  assertFaultOptions(queryMarker, options)
  return runPoolObservationExclusively(async () => {
    const context = { active: true }
    const ownsContext = () =>
      context.active && (queryFailureContext.getStore() === context || ownsRequest(options))
    let fired = false
    let targetError: Error | undefined
    const restorations = new Set<() => void>()
    const poolDescriptors = options.pools.map((pool) => ({
      pool,
      descriptor: Object.getOwnPropertyDescriptor(pool, 'connect'),
      connect: pool.connect,
    }))

    function observeClient(client: pg.PoolClient): pg.PoolClient {
      const queryDescriptor = Object.getOwnPropertyDescriptor(client, 'query')
      const releaseDescriptor = Object.getOwnPropertyDescriptor(client, 'release')
      const originalQuery = client.query
      const originalRelease = client.release
      let began = false
      const restore = () => {
        restoreProperty(client, 'query', queryDescriptor)
        restoreProperty(client, 'release', releaseDescriptor)
        restorations.delete(restore)
      }
      restorations.add(restore)

      async function failActualStatement(args: unknown[]): Promise<unknown> {
        try {
          await (Reflect.apply(originalQuery, client, [
            '/* withPostgresQueryFailureForTest */ SELECT 1 / 0',
          ]) as Promise<unknown>)
          throw new Error('PostgreSQL unexpectedly accepted division by zero')
        } catch (err) {
          if (!hasErrorCode(err, '22012')) throw err
        }
        try {
          return await (Reflect.apply(originalQuery, client, args) as Promise<unknown>)
        } catch (err) {
          if (!hasErrorCode(err, '25P02')) throw err
          targetError = err
          throw err
        }
      }

      installProperty(client, 'query', (...args: unknown[]) => {
        const text = queryText(args[0])
        const command = text.trimStart().replace(/^\/\*[\s\S]*?\*\/\s*/, '')
        const owned = ownsContext()
        if (owned && /^BEGIN\b/.test(command)) began = true
        if (owned && /^(?:COMMIT|ROLLBACK)\b/.test(command)) began = false
        if (!owned || fired || !targetsStatement(text, queryMarker, options.command))
          return Reflect.apply(originalQuery, client, args)
        if (!began || !isPlainTextConfig(args))
          throw new Error('Target fault requires the owned transaction adapter Promise query')
        fired = true
        return failActualStatement(args)
      })
      installProperty(client, 'release', (...args: unknown[]) => {
        restore()
        return Reflect.apply(originalRelease, client, args)
      })
      return client
    }

    try {
      for (const { pool, connect } of poolDescriptors) {
        installProperty(pool, 'connect', (...args: unknown[]) => {
          // Pool.query uses a callback; preserve that overload and every other context exactly.
          if (args.length || !ownsContext()) return Reflect.apply(connect, pool, args)
          return (Reflect.apply(connect, pool, args) as Promise<pg.PoolClient>).then((client) =>
            context.active ? observeClient(client) : client,
          )
        })
      }
      return await queryFailureContext.run(context, async () => {
        const result = await operation()
        if (!targetError) throw new Error('The operation did not execute the targeted failed SQL')
        return { result, error: targetError }
      })
    } finally {
      context.active = false
      for (const restore of restorations) restore()
      for (const { pool, descriptor } of poolDescriptors)
        restoreProperty(pool, 'connect', descriptor)
    }
  })
}
