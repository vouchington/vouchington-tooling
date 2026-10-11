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
  return createRegistration(original, kind, maximum, true)
}

function createRegistration<T extends Registration>(
  original: T,
  kind: Kind,
  maximum: number,
  injectFactory: boolean,
): T {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(original, {
    apply(target, receiver, args) {
      if (kind === 'hook') {
        if (args[1] !== undefined) assertTestTimeout(args[1], 'hook timeout', maximum)
      } else {
        for (let index = 1; index < Math.min(args.length, 3); index++) {
          const value: unknown = args[index]
          if (kind === 'suite' && injectFactory && typeof value === 'function') {
            args[index] = protectSuiteFactory(value, maximum)
          } else if (typeof value === 'number') assertTestTimeout(value, `${kind} timeout`, maximum)
          else if (value !== null && typeof value === 'object') {
            args[index] = snapshotTimeoutOptions(value, `${kind} timeout`, maximum, true)
          }
        }
      }
      const result: unknown = Reflect.apply(target, receiver, args)
      return kind === 'suite' &&
        result !== null &&
        typeof result === 'object' &&
        Reflect.get(result, 'type') === 'collector'
        ? protectSuiteCollector(result, maximum)
        : result
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
                ? createRegistration(
                    result as Registration,
                    kind,
                    maximum,
                    injectFactory && name !== 'each' && name !== 'for',
                  )
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

function protectSuiteFactory(factory: Function, maximum: number): Function {
  return new Proxy(factory, {
    apply(target, owner, values) {
      // The known direct suite-factory route always receives Vitest's public TestAPI.
      values[0] = guardRegistration(values[0] as Registration, 'test', maximum)
      return Reflect.apply(target, owner, values)
    },
  })
}

const collectors = new WeakMap<object, Map<number, object>>()

/** Native collector.on stores raw callbacks, bypassing Vitest's public hook timeout capture. */
function protectSuiteCollector(original: object, maximum: number): object {
  const deadlines = collectors.get(original) ?? new Map<number, object>()
  const existing = deadlines.get(maximum)
  if (existing) return existing
  const tests = new Map<unknown, unknown>()
  const rejectRawHook = () => {
    throw new Error(
      'SuiteCollector.on bypasses native hook deadlines; register guarded public hooks inside the suite factory',
    )
  }
  const guarded = new Proxy(original, {
    get(target, key, receiver) {
      if (key === 'on') return rejectRawHook
      const value: unknown = Reflect.get(target, key, receiver)
      if (key !== 'test' || typeof value !== 'function') return value
      if (!tests.has(value))
        tests.set(value, guardRegistration(value as Registration, 'test', maximum))
      return tests.get(value)
    },
  })
  deadlines.set(maximum, guarded)
  collectors.set(original, deadlines)
  return guarded
}
