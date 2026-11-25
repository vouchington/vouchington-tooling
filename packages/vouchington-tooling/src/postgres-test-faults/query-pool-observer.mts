import { AsyncLocalStorage } from 'node:async_hooks'
import type pg from 'pg'
import { clientQueryText, tapClientQueries, type ObservedClientQuery } from './client-query-tap.mts'
import { runPoolObservationExclusively } from './observation-queue.mts'

interface PoolObservationContext<Label extends string> {
  active: boolean
  pools: Set<Label>
  queryMarker: string
  onQueryComplete?: (() => void | Promise<void>) | undefined
}

const poolObservationContext = new AsyncLocalStorage<PoolObservationContext<string>>()

/** Observes which labeled pools receive `pool.query(...)` statements containing `queryMarker`. */
export async function observeTestPostgresQueryPools<Label extends string, Result>(
  pools: Readonly<Record<Label, pg.Pool>>,
  queryMarker: string,
  operation: () => Promise<Result>,
  onQueryComplete?: () => void | Promise<void>,
): Promise<{ result: Result; pools: Label[] }> {
  const activeObservation = poolObservationContext.getStore()
  if (activeObservation?.active) {
    if (activeObservation.queryMarker !== queryMarker) {
      throw new Error('Nested PostgreSQL pool observations must use the same query marker')
    }
    const result = await operation()
    return { result, pools: [...(activeObservation.pools as Set<Label>)] }
  }

  return runPoolObservationExclusively(async () => {
    const context: PoolObservationContext<Label> = {
      active: true,
      pools: new Set(),
      queryMarker,
      onQueryComplete,
    }
    return poolObservationContext.run(context as PoolObservationContext<string>, async () => {
      const entries = Object.entries(pools) as Array<[Label, pg.Pool]>
      const saved: Array<{ pool: pg.Pool; descriptor: PropertyDescriptor | undefined }> = []
      try {
        for (const [label, pool] of entries) {
          const descriptor = Object.getOwnPropertyDescriptor(pool, 'query')
          const original = Reflect.get(pool, 'query') as pg.Pool['query']
          Object.defineProperty(pool, 'query', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: wrapPoolQuery(pool, original, label, context as PoolObservationContext<string>),
          })
          saved.push({ pool, descriptor })
        }
        const result = await operation()
        return { result, pools: [...context.pools] }
      } finally {
        context.active = false
        for (const { pool, descriptor } of saved.toReversed()) {
          if (descriptor) Object.defineProperty(pool, 'query', descriptor)
          else Reflect.deleteProperty(pool, 'query')
        }
      }
    })
  })
}

/** Records SQL run on borrowed clients across labeled pools. */
export async function observeTestPostgresClientQueries<Label extends string, Result>(
  pools: Readonly<Record<Label, pg.Pool>>,
  operation: () => Promise<Result>,
  onQueryComplete?: (query: ObservedClientQuery<Label>) => Promise<void>,
): Promise<{ result: Result; queries: ObservedClientQuery<Label>[] }> {
  return runPoolObservationExclusively(async () => {
    const queries: ObservedClientQuery<Label>[] = []
    let active = true
    const completed = async (query: ObservedClientQuery<Label>) => {
      if (active) await onQueryComplete?.(query)
    }
    const entries = Object.entries(pools) as Array<[Label, pg.Pool]>
    const restores: Array<() => void> = []
    try {
      for (const [label, pool] of entries) {
        restores.push(tapClientQueries(pool, label, queries, completed))
      }
      const result = await operation()
      return { result, queries }
    } finally {
      active = false
      for (const restore of restores.toReversed()) restore()
    }
  })
}

function wrapPoolQuery(
  pool: pg.Pool,
  query: pg.Pool['query'],
  label: string,
  expectedContext: PoolObservationContext<string>,
): pg.Pool['query'] {
  return ((...args: unknown[]) => {
    const text = clientQueryText(args[0])
    const activeContext = poolObservationContext.getStore()
    const matchesContext =
      activeContext === expectedContext &&
      expectedContext.active &&
      text.includes(expectedContext.queryMarker)
    if (matchesContext) expectedContext.pools.add(label)
    const callbackIndex = args.findIndex((arg) => typeof arg === 'function')
    if (matchesContext && expectedContext.onQueryComplete && callbackIndex >= 0) {
      const callback = args[callbackIndex] as (...cbArgs: unknown[]) => unknown
      const wrappedArgs = [...args]
      wrappedArgs[callbackIndex] = function (this: unknown, ...cbArgs: unknown[]) {
        if (cbArgs[0] == null && expectedContext.active) {
          void Promise.resolve(expectedContext.onQueryComplete?.()).then(() =>
            Reflect.apply(callback, this, cbArgs),
          )
          return
        }
        return Reflect.apply(callback, this, cbArgs)
      }
      return Reflect.apply(query, pool, wrappedArgs)
    }
    const result = Reflect.apply(query, pool, args)
    if (matchesContext && expectedContext.onQueryComplete) {
      return Promise.resolve(result).then(async (value) => {
        if (expectedContext.active) await expectedContext.onQueryComplete?.()
        return value
      })
    }
    return result
  }) as unknown as pg.Pool['query']
}
