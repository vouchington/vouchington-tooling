import {
  assertTestTimeout,
  assertTimeoutConfig,
  snapshotTimeoutOptions,
  protectTimeoutConfig,
} from './config.mts'
export {
  assertTestTimeout,
  assertTimeoutConfig,
  snapshotTimeoutOptions,
  protectTimeoutConfig,
} from './config.mts'

const installedRunners = new WeakMap<object, { maximum: number; config: object }>()

type Registration = (...args: never[]) => unknown
type Kind = 'test' | 'suite' | 'hook'
const curriedMethods = new Set(['each', 'for', 'extend', 'override', 'scoped', 'skipIf', 'runIf'])
const chainedMethods = new Set(['concurrent', 'shuffle', 'skip', 'only', 'todo', 'fails'])
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
        name !== 'describe' &&
        name !== 'suite'
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
            hookMethods.has(name)
              ? 'hook'
              : name === 'describe' || name === 'suite'
                ? 'suite'
                : kind,
            maximum,
          )
      cache.set(key, guarded)
      return guarded
    },
  })
}

/** Aliased/destructured setters retain validation because the returned method is guarded. */
export function guardRuntimeConfig<T extends object>(api: T, maximum = 30_000): T {
  const original: unknown = Reflect.get(api, 'setConfig')
  if (typeof original !== 'function') throw new TypeError('Expected a Vitest setConfig method')
  const setter = (config: object) => {
    const snapshot = { ...config }
    assertTimeoutConfig(snapshot, maximum)
    return Reflect.apply(original, api, [snapshot])
  }
  return new Proxy(api, {
    get(target, key, receiver) {
      return key === 'setConfig' ? setter : Reflect.get(target, key, receiver)
    },
  })
}

/** A single current Vitest API facade. Adoption must route every test import through it. */
export function guardVitestExports<T extends object>(api: T, maximum = 30_000): T {
  const cache = new Map<PropertyKey, unknown>()
  const kinds = new Map<string, Kind>([
    ['test', 'test'],
    ['it', 'test'],
    ['describe', 'suite'],
    ['suite', 'suite'],
    ['beforeAll', 'hook'],
    ['beforeEach', 'hook'],
    ['afterAll', 'hook'],
    ['afterEach', 'hook'],
    ['aroundAll', 'hook'],
    ['aroundEach', 'hook'],
    ['onTestFailed', 'hook'],
    ['onTestFinished', 'hook'],
  ])
  return new Proxy(api, {
    get(target, key, receiver) {
      if (cache.has(key)) return cache.get(key)
      const value: unknown = Reflect.get(target, key, receiver)
      const kind = kinds.get(String(key))
      const guarded =
        (key === 'vi' || key === 'vitest') && value !== null && typeof value === 'object'
          ? guardRuntimeConfig(value, maximum)
          : kind && typeof value === 'function'
            ? guardRegistration(value as Registration, kind, maximum)
            : value
      cache.set(key, guarded)
      return guarded
    },
  })
}

/** Compose at runner construction, without replacing existing collection/database guards. */
export function protectRunnerTimeouts(runner: { config: object }, maximum = 30_000): void {
  const existing = installedRunners.get(runner)
  if (existing) {
    if (existing.maximum !== maximum || existing.config !== runner.config)
      throw new Error('Installed runner timeout policy cannot be replaced')
    return
  }
  if (Reflect.get(runner.config, 'globals') === true)
    throw new Error('Timeout policy requires guarded public imports with globals disabled')
  protectTimeoutConfig(runner.config, maximum)
  const extend: unknown = Reflect.get(runner, 'extendTaskContext')
  const extendTaskContext = (context: object) => {
    // Vitest 5 creates the context after resolving task.timeout, before withTimeout.
    // withTimeout uses a pre-context local timeout; extensions must not mask invalid tasks.
    const task: unknown = Reflect.get(context, 'task')
    if (task === null || typeof task !== 'object')
      throw new TypeError('Expected Vitest task context')
    assertTestTimeout(Reflect.get(task, 'timeout'), 'Vitest resolved test timeout', maximum)
    const result =
      typeof extend === 'function' ? (Reflect.apply(extend, runner, [context]) as object) : context
    // Recheck the original task, even if the extension returns a replacement context.
    assertTestTimeout(Reflect.get(task, 'timeout'), 'Vitest resolved test timeout', maximum)
    for (const name of ['onTestFailed', 'onTestFinished']) {
      const original: unknown = Reflect.get(result, name)
      if (typeof original === 'function')
        Object.defineProperty(result, name, {
          value: guardRegistration(original as Registration, 'hook', maximum),
          writable: false,
          configurable: false,
        })
    }
    return result
  }
  Object.defineProperty(runner, 'extendTaskContext', {
    value: extendTaskContext,
    writable: false,
    configurable: false,
  })
  installedRunners.set(runner, { maximum, config: runner.config })
}
