import { AsyncLocalStorage } from 'node:async_hooks'
import type pg from 'pg'
import { runPoolObservationExclusively } from './observation-queue.mts'

export type ObservedClientQuery<Label extends string = string> = {
  pool: Label
  text: string
  values: readonly unknown[]
}

export function clientQueryText(input: unknown): string {
  if (typeof input === 'string') return input
  if (typeof input === 'object' && input !== null && 'text' in input) return String(input.text)
  return ''
}

function clientQueryValues(args: readonly unknown[]): readonly unknown[] {
  const [input, parameters] = args
  if (
    typeof input === 'object' &&
    input !== null &&
    'values' in input &&
    Array.isArray(input.values)
  ) {
    return input.values
  }
  return Array.isArray(parameters) ? parameters : []
}

/** Taps every Promise `pool.connect()` client on `pool`, recording each `client.query` call. */
export function tapClientQueries<Label extends string>(
  pool: pg.Pool,
  label: Label,
  queries: ObservedClientQuery<Label>[],
  onQueryComplete: (query: ObservedClientQuery<Label>) => Promise<void>,
): () => void {
  const restoreClients: Array<() => void> = []
  const descriptor = Object.getOwnPropertyDescriptor(pool, 'connect')
  const original = Reflect.get(pool, 'connect') as pg.Pool['connect']
  Object.defineProperty(pool, 'connect', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: ((...args: unknown[]) => {
      if (args.some((arg) => typeof arg === 'function')) return Reflect.apply(original, pool, args)
      return Promise.resolve(Reflect.apply(original, pool, args)).then((client: pg.PoolClient) => {
        if (!client) return client
        const queryDescriptor = Object.getOwnPropertyDescriptor(client, 'query')
        const query = Reflect.get(client, 'query') as pg.PoolClient['query']
        const wrappedQuery = ((...queryArgs: unknown[]) => {
          const observed: ObservedClientQuery<Label> = {
            pool: label,
            text: clientQueryText(queryArgs[0]),
            values: clientQueryValues(queryArgs),
          }
          queries.push(observed)
          const pending: unknown = Reflect.apply(query, client, queryArgs)
          if (
            queryArgs.some((arg) => typeof arg === 'function') ||
            typeof pending !== 'object' ||
            pending === null ||
            !('then' in pending) ||
            typeof pending.then !== 'function'
          ) {
            return pending
          }
          return Promise.resolve(pending).then(async (result: unknown) => {
            await onQueryComplete(observed)
            return result
          })
        }) as typeof client.query
        client.query = wrappedQuery
        restoreClients.push(() => {
          if (client.query !== wrappedQuery) return
          if (queryDescriptor) Object.defineProperty(client, 'query', queryDescriptor)
          else Reflect.deleteProperty(client, 'query')
        })
        return client
      })
    }) as typeof pool.connect,
  })
  return () => {
    if (descriptor) Object.defineProperty(pool, 'connect', descriptor)
    else Reflect.deleteProperty(pool, 'connect')
    for (const restore of restoreClients.toReversed()) restore()
  }
}

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
      const saved = entries.map(([label, pool]) => ({
        label,
        pool,
        descriptor: Object.getOwnPropertyDescriptor(pool, 'query'),
        original: Reflect.get(pool, 'query') as pg.Pool['query'],
      }))
      try {
        for (const { label, pool, original } of saved) {
          Object.defineProperty(pool, 'query', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: wrapPoolQuery(pool, original, label, context as PoolObservationContext<string>),
          })
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
    const restores = entries.map(([label, pool]) =>
      tapClientQueries(pool, label, queries, completed),
    )
    try {
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
    const result = Reflect.apply(query, pool, args)
    if (matchesContext && expectedContext.onQueryComplete) {
      return Promise.resolve(result).then(async (value) => {
        await expectedContext.onQueryComplete?.()
        return value
      })
    }
    return result
  }) as unknown as pg.Pool['query']
}
