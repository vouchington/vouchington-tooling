import type pg from 'pg'

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
  const wrappedClients = new WeakSet<pg.PoolClient>()
  let disposed = false
  const descriptor = Object.getOwnPropertyDescriptor(pool, 'connect')
  const original = Reflect.get(pool, 'connect') as pg.Pool['connect']
  Object.defineProperty(pool, 'connect', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: ((...args: unknown[]) => {
      if (args.some((arg) => typeof arg === 'function')) return Reflect.apply(original, pool, args)
      return Promise.resolve(Reflect.apply(original, pool, args)).then((client: pg.PoolClient) => {
        if (!client || disposed || wrappedClients.has(client)) return client
        wrappedClients.add(client)
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
          if (Reflect.get(client, 'query') !== wrappedQuery) return
          if (queryDescriptor) Object.defineProperty(client, 'query', queryDescriptor)
          else Reflect.deleteProperty(client, 'query')
        })
        return client
      })
    }) as typeof pool.connect,
  })
  return () => {
    disposed = true
    if (descriptor) Object.defineProperty(pool, 'connect', descriptor)
    else Reflect.deleteProperty(pool, 'connect')
    for (const restore of restoreClients.toReversed()) restore()
  }
}
