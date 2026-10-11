import { guardRegistration, type Registration, type Kind } from './registration.mts'
export { guardRegistration } from './registration.mts'
import { guardPublicRunner, type RunnerConstructor } from './public-runner.mts'
export { guardPublicRunner, type RunnerConstructor, type Protector } from './public-runner.mts'
import { assertTestTimeout, assertTimeoutConfig, protectTimeoutConfig } from './config.mts'
export {
  assertTestTimeout,
  assertTimeoutConfig,
  snapshotTimeoutOptions,
  protectTimeoutConfig,
} from './config.mts'

const installedRunners = new WeakMap<object, { maximum: number; config: object }>()
const installedContexts = new WeakMap<object, number>()

function protectContextHooks(context: object, maximum: number): void {
  const existing = installedContexts.get(context)
  if (existing !== undefined) {
    if (existing !== maximum) throw new Error('Context timeout policy maximum cannot change')
    return
  }
  for (const name of ['onTestFailed', 'onTestFinished']) {
    const original: unknown = Reflect.get(context, name)
    if (typeof original === 'function') {
      let guarded = guardRegistration(original as Registration, 'hook', maximum)
      Object.defineProperty(context, name, {
        // Vitest temporarily replaces/restores these methods while executing completion hooks.
        get: () => guarded,
        set(next: unknown) {
          if (typeof next !== 'function') throw new TypeError('Expected a completion hook method')
          guarded = guardRegistration(next as Registration, 'hook', maximum)
        },
        configurable: false,
      })
    }
  }
  installedContexts.set(context, maximum)
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
  const cache = new Map<unknown, Map<PropertyKey, unknown>>()
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
      const value: unknown = Reflect.get(target, key, receiver)
      const kind = kinds.get(String(key))
      const role = kind ?? (key === 'vitest' ? 'vi' : key)
      const values = cache.get(value) ?? new Map<PropertyKey, unknown>()
      if (values.has(role)) return values.get(role)
      const guarded =
        key === 'TestRunner' && typeof value === 'function'
          ? guardPublicRunner(value as RunnerConstructor, maximum, protectRunnerTimeouts)
          : (key === 'vi' || key === 'vitest') && value !== null && typeof value === 'object'
            ? guardRuntimeConfig(value, maximum)
            : kind && typeof value === 'function'
              ? guardRegistration(value as Registration, kind, maximum)
              : value
      values.set(role, guarded)
      cache.set(value, values)
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
  const config = runner.config
  const extend: unknown = Reflect.get(runner, 'extendTaskContext')
  const extendTaskContext = (context: object) => {
    if (runner.config !== config)
      throw new Error('Runner timeout configuration identity changed after construction')
    // Vitest 5 creates the context after resolving task.timeout, before withTimeout.
    // withTimeout uses a pre-context local timeout; extensions must not mask invalid tasks.
    const task: unknown = Reflect.get(context, 'task')
    if (task === null || typeof task !== 'object')
      throw new TypeError('Expected Vitest task context')
    assertTestTimeout(Reflect.get(task, 'timeout'), 'Vitest resolved test timeout', maximum)
    protectContextHooks(context, maximum)
    const result =
      typeof extend === 'function' ? (Reflect.apply(extend, runner, [context]) as object) : context
    if (runner.config !== config)
      throw new Error('Runner timeout configuration identity changed during context extension')
    // Recheck the original task, even if the extension returns a replacement context.
    assertTestTimeout(Reflect.get(task, 'timeout'), 'Vitest resolved test timeout', maximum)
    protectContextHooks(result, maximum)
    return result
  }
  Object.defineProperty(runner, 'extendTaskContext', {
    value: extendTaskContext,
    writable: false,
    configurable: false,
  })
  installedRunners.set(runner, { maximum, config: runner.config })
}
