import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi, TestRunner } from 'vitest'
import {
  assertTestTimeout,
  assertTimeoutConfig,
  snapshotTimeoutOptions,
  protectTimeoutConfig,
  guardRegistration,
  guardRuntimeConfig,
  guardVitestExports,
  protectRunnerTimeouts,
} from './index.mts'
import { testTimeoutPolicyPlugin } from './plugin.mts'

describe('public deadline policy contract boundaries', () => {
  it.each([0, -1, NaN, Infinity, '30000', 30001])(
    'rejects invalid configured value %s',
    (value) => {
      expect(() => assertTestTimeout(value, 'test timeout')).toThrow(RangeError)
    },
  )

  it('accepts the inclusive deadline and rejects invalid policy maxima', () => {
    expect(assertTestTimeout(30000, 'test timeout')).toBe(30000)
    for (const maximum of [0, NaN, Infinity])
      expect(() => assertTestTimeout(1, 'test timeout', maximum)).toThrow(RangeError)
    expect(() => assertTimeoutConfig({})).not.toThrow()
    expect(() => assertTimeoutConfig({ hookTimeout: 0 })).toThrow(RangeError)
  })

  it('captures timeout getters once while retaining other getter receivers', () => {
    class Options {
      #label = 'owned'
      reads = 0
      get timeout() {
        return ++this.reads === 1 ? 25 : 30001
      }
      get label() {
        return this.#label
      }
    }
    const options = new Options()
    const captured = snapshotTimeoutOptions(options, 'test timeout')
    expect(Reflect.get(captured, 'timeout')).toBe(25)
    expect(Reflect.get(captured, 'timeout')).toBe(25)
    expect(Reflect.get(captured, 'label')).toBe('owned')
    expect(options.reads).toBe(1)
    expect(() => snapshotTimeoutOptions({ timeout: null }, 'test')).toThrow(RangeError)
    expect(
      Reflect.get(snapshotTimeoutOptions({ timeout: null }, 'test', 30000, true), 'timeout'),
    ).toBeNull()
    expect(Reflect.get(snapshotTimeoutOptions({}, 'test'), 'timeout')).toBeUndefined()
  })

  it('protects one config object across repeated installation and invalid writes', () => {
    const config = { testTimeout: 25, hookTimeout: 30 }
    protectTimeoutConfig(config)
    protectTimeoutConfig(config)
    expect(() => protectTimeoutConfig(config, 100)).toThrow('maximum cannot change')
    config.testTimeout = 30000
    config.hookTimeout = 50
    expect(() => {
      config.testTimeout = 0
    }).toThrow(RangeError)
    expect(config.testTimeout).toBe(30000)
    expect(config.hookTimeout).toBe(50)
    expect(() => Object.defineProperty(config, 'hookTimeout', { value: 0 })).toThrow(TypeError)
  })

  it('retains registration receiver, return value, optional args and unknown callable identity', () => {
    const receiver = { owned: true }
    const original = vi.fn(function (this: unknown, ...args: unknown[]) {
      return { receiver: this, args }
    })
    const fn = () => 'SDK callable metadata'
    const register = Object.assign(original, { fn, label: 'preserved' })
    Object.defineProperty(register, 'fn', { value: fn, writable: false, configurable: false })
    const guarded = guardRegistration(register, 'test')
    const options = { timeout: 25 }
    const result = guarded.call(receiver, 'name', options, () => {})
    expect(result.receiver).toBe(receiver)
    expect(result.args[0]).toBe('name')
    expect(Reflect.get(result.args[1] as object, 'timeout')).toBe(25)
    expect(guarded.fn).toBe(fn)
    expect(guarded.label).toBe('preserved')
    expect(() => guarded('name', 30001)).toThrow(RangeError)
    expect(() => guarded('name', null)).not.toThrow()
    const hook = guardRegistration(original, 'hook')
    expect(() => hook(() => {}, 0)).toThrow(RangeError)
    expect(() => hook(() => {})).not.toThrow()
  })

  it('guards chained, curried and hook properties while retaining cache identity', () => {
    const target = (...args: unknown[]) => args
    const methods = Object.assign(target, {
      shuffle: target,
      describe: target,
      beforeAll: target,
      each: () => target,
      runIf: () => target,
      extend: () => ({ opaque: true }),
    })
    const guarded = guardRegistration(methods, 'suite')
    expect(guarded.shuffle).toBe(guarded.shuffle)
    expect(() => guarded.shuffle('name', 30001)).toThrow(RangeError)
    expect(() => guarded.describe('name', { timeout: 30001 })).toThrow(RangeError)
    expect(() => guarded.beforeAll(() => {}, 0)).toThrow(RangeError)
    expect(() => guarded.each()('name', 30001)).toThrow(RangeError)
    expect(() => guarded.runIf()('name', 30001)).toThrow(RangeError)
    expect(guarded.extend()).toEqual({ opaque: true })
  })

  it('snapshots aliased setter options and preserves configuration API receiver', () => {
    const api = {
      value: 25,
      setConfig(config: object) {
        this.value = Reflect.get(config, 'testTimeout')
        return 'applied'
      },
    }
    const wrapped = guardRuntimeConfig(api)
    // Runtime alias extraction deliberately carries no receiver; the guard must preserve it.
    const setConfig: unknown = Reflect.get(wrapped, 'setConfig')
    if (typeof setConfig !== 'function') throw new Error('Configuration setter missing')
    let reads = 0
    expect(
      setConfig({
        get testTimeout() {
          return ++reads === 1 ? 30 : 30001
        },
      }),
    ).toBe('applied')
    expect(api.value).toBe(30)
    expect(reads).toBe(1)
    expect(() => setConfig({ testTimeout: 0 })).toThrow(RangeError)
    expect(wrapped.value).toBe(30)
    expect(() => guardRuntimeConfig({})).toThrow(TypeError)
  })

  it('caches guarded public exports and preserves unrelated values', () => {
    const register = vi.fn()
    const api = { test: register, beforeAll: register, vi: { setConfig: vi.fn() }, value: null }
    const guarded = guardVitestExports(api)
    expect(guarded.test).toBe(guarded.test)
    expect(guarded.vi).toBe(guarded.vi)
    expect(guarded.value).toBeNull()
    expect(() => guarded.test('name', 30001)).toThrow(RangeError)
    expect(() => guarded.beforeAll(() => {}, 0)).toThrow(RangeError)
    expect(() => guarded.vi.setConfig({ hookTimeout: Infinity })).toThrow(RangeError)
  })

  it('guards constructor exports in the parent while preserving constructor and instance identity', () => {
    class Runner {
      #marker = 'owned'
      constructor(public config: { testTimeout: number; hookTimeout: number }) {}
      marker() {
        return this.#marker
      }
    }
    const facade = guardVitestExports({ TestRunner: Runner })
    expect(facade.TestRunner).toBe(facade.TestRunner)
    const runner = new facade.TestRunner({ testTimeout: 25, hookTimeout: 25 })
    expect(runner).toBeInstanceOf(Runner)
    expect(runner.marker()).toBe('owned')
    expect(() => {
      runner.config.testTimeout = 30001
    }).toThrow(RangeError)
    expect(() => new facade.TestRunner({ testTimeout: 0, hookTimeout: 25 })).toThrow(RangeError)
    expect(guardVitestExports({ TestRunner: null }).TestRunner).toBeNull()
  })

  it('worker-loads the generated Node facade without guarding a custom runner base prematurely', async () => {
    const plugin = testTimeoutPolicyPlugin(30000, [], { runner: null })
    const id = plugin.resolveId('vitest', '/owned/case.mts')!
    const directory = await mkdtemp(join(tmpdir(), 'parent-node-facade-'))
    try {
      await symlink(
        fileURLToPath(new URL('../../../../node_modules', import.meta.url)),
        join(directory, 'node_modules'),
      )
      const module = join(directory, 'facade.mts')
      await writeFile(module, plugin.load(id)!)
      const facade: { TestRunner: typeof TestRunner } = await import(module)
      expect(facade.TestRunner).toBe(TestRunner)
      class Custom extends facade.TestRunner {}
      expect(Object.getPrototypeOf(Custom.prototype)).toBe(TestRunner.prototype)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('composes runner context and completion callbacks without masking raw invalid tasks', () => {
    const extension = vi.fn((context: object) => context)
    const runner = { config: { testTimeout: 25, hookTimeout: 25 }, extendTaskContext: extension }
    protectRunnerTimeouts(runner)
    protectRunnerTimeouts(runner)
    expect(() => protectRunnerTimeouts(runner, 100)).toThrow('cannot be replaced')
    expect(() => runner.extendTaskContext({ task: { timeout: 0 } })).toThrow(RangeError)
    expect(extension).not.toHaveBeenCalled()
    const callback = vi.fn()
    const context = { task: { timeout: 25 }, onTestFinished: callback }
    expect(runner.extendTaskContext(context)).toBe(context)
    expect(extension).toHaveBeenCalledWith(context)
    expect(() => context.onTestFinished(() => {}, 0)).toThrow(RangeError)
    context.onTestFinished(() => {}, 25)
    expect(callback).toHaveBeenCalledOnce()
    expect(() => runner.extendTaskContext({ task: null })).toThrow(TypeError)
  })

  it('rejects post-extension mutation of the original task and supports context-only adapters', () => {
    const runner = {
      config: { testTimeout: 25, hookTimeout: 25 },
      extendTaskContext(context: { task: { timeout: number } }) {
        context.task.timeout = 30001
        return { task: { timeout: 25 } }
      },
    }
    protectRunnerTimeouts(runner)
    expect(() => runner.extendTaskContext({ task: { timeout: 25 } })).toThrow(RangeError)
    const simple = { config: { testTimeout: 25, hookTimeout: 25 } }
    protectRunnerTimeouts(simple)
    const context = { task: { timeout: 25 } }
    expect(Reflect.apply(Reflect.get(simple, 'extendTaskContext'), simple, [context])).toBe(context)
    expect(() => protectRunnerTimeouts({ config: { globals: true } })).toThrow('globals disabled')
    simple.config = { testTimeout: 25, hookTimeout: 25 }
    expect(() => protectRunnerTimeouts(simple)).toThrow('cannot be replaced')
  })

  it('routes only public Vitest imports and explicitly declares registrar inlining', () => {
    const plugin = testTimeoutPolicyPlugin(30000, ['owned-registrar'])
    expect(plugin.config()).toEqual({ test: { server: { deps: { inline: ['owned-registrar'] } } } })
    expect(() => testTimeoutPolicyPlugin(0)).toThrow(RangeError)
    expect(plugin.resolveId('other', '/case.mts')).toBeNull()
    expect(plugin.resolveId('vitest')).toBeNull()
    const id = plugin.resolveId('vitest', '/node_modules/owned-registrar/index.mjs')!
    expect(plugin.resolveId('vitest', id)).toBeNull()
    expect(plugin.load('other')).toBeNull()
    // Vite load must supply module code for the owned route; SDK children prove its behavior.
    expect(plugin.load(id)).toBeTypeOf('string')
    // Registration-only routing must leave an independently supplied runner intact.
    const resolved = { test: { runner: '/owned/existing-runner.mjs' } }
    expect(() => plugin.configResolved(resolved)).not.toThrow()
    expect(resolved.test.runner).toBe('/owned/existing-runner.mjs')
  })
  it('keeps final Node runner provenance and rejects conflicting merged or browser slots', () => {
    const plugin = testTimeoutPolicyPlugin(30000, [], { runner: '/owned/final-runner.mjs' })
    const configured = plugin.config({ test: { runner: '/owned/final-runner.mjs' } })
    const runner = configured.test.runner!
    expect(plugin.resolveId(runner)).toBe(runner)
    expect(plugin.load(runner)).toBeTypeOf('string')
    expect(plugin.resolveId('vitest', runner)).toBeNull()
    expect(() => plugin.config({ test: { runner: '/other/runner.mjs' } })).toThrow('differs')
    expect(() => plugin.configResolved({ test: { runner } })).not.toThrow()
    expect(() => plugin.configResolved({ test: { runner: '/overridden.mjs' } })).toThrow('replaced')
    expect(() => plugin.configResolved({ test: { runner, browser: { enabled: true } } })).toThrow(
      'browser',
    )
    expect(() => testTimeoutPolicyPlugin(30000, [], { runner: './relative.mjs' })).toThrow(
      'absolute',
    )
    const native = testTimeoutPolicyPlugin(30000, [], { runner: null })
    expect(native.load(native.config().test.runner!)).toBeTypeOf('string')
  })
})
