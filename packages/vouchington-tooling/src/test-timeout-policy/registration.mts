import { assertTestTimeout, snapshotTimeoutOptions } from './config.mts'

export type Registration = (...args: never[]) => unknown
export type Kind = 'test' | 'suite' | 'hook'
const curriedMethods = new Set(['each', 'for', 'extend', 'override', 'scoped', 'skipIf', 'runIf'])
const chainedMethods = new Set(['concurrent', 'shuffle', 'skip', 'only', 'todo', 'fails'])
const suiteMethods = new Set(['describe', 'suite'])
const hookMethods = new Set([
  'beforeAll',
  'beforeEach',
  'afterAll',
  'afterEach',
  'aroundAll',
  'aroundEach',
])

/** Validate before Vitest's registration creates its captured timeout wrapper. */
export function guardRegistration<T extends Registration>(
  original: T,
  kind: Kind,
  maximum = 30_000,
): T {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(original, {
    apply(target, receiver, args) {
      if (kind === 'hook') {
        if (args[1] !== undefined) assertTestTimeout(args[1], 'hook timeout', maximum)
      } else {
        for (let index = 1; index < Math.min(args.length, 3); index++) {
          const value: unknown = args[index]
          if (typeof value === 'number') assertTestTimeout(value, `${kind} timeout`, maximum)
          else if (value !== null && typeof value === 'object') {
            args[index] = snapshotTimeoutOptions(value, `${kind} timeout`, maximum, true)
          }
        }
      }
      return Reflect.apply(target, receiver, args)
    },
    get(target, key, receiver) {
      if (cache.has(key)) return cache.get(key)
      const value: unknown = Reflect.get(target, key, receiver)
      if (typeof value !== 'function') return value
      const name = String(key)
      if (
        !curriedMethods.has(name) &&
        !chainedMethods.has(name) &&
        !hookMethods.has(name) &&
        !suiteMethods.has(name)
      )
        return value
      const guarded = curriedMethods.has(name)
        ? new Proxy(value, {
            apply(method, owner, args) {
              const result: unknown = Reflect.apply(method, owner, args)
              return typeof result === 'function'
                ? guardRegistration(result as Registration, kind, maximum)
                : result
            },
          })
        : guardRegistration(
            value as Registration,
            hookMethods.has(name) ? 'hook' : suiteMethods.has(name) ? 'suite' : kind,
            maximum,
          )
      cache.set(key, guarded)
      return guarded
    },
  })
}
