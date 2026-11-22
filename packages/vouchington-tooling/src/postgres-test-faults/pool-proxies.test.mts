/* oxlint-disable typescript/unbound-method -- the fake pool `connect` mocks are compared detached on purpose */
import { AsyncLocalStorage } from 'node:async_hooks'
import type pg from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createLoan: vi.fn(),
  discard: vi.fn(),
}))

vi.mock('./client-loan.mts', () => ({
  createTestPostgresClientLoan: mocks.createLoan,
  discardTestPostgresClient: mocks.discard,
}))

const { installTestOwnedPostgresPoolProxy } = await import('./owned-wait-pool-proxy.mts')
const { installTestPostgresMultiWaitPoolProxy } = await import('./multi-wait-pool-proxy.mts')

type Loan = { ready: Promise<void>; dispose: () => Promise<void>; wait: () => Promise<void> }
const loanOf = (overrides: Partial<Loan> = {}): Loan => ({
  ready: Promise.resolve(),
  dispose: async () => undefined,
  wait: async () => undefined,
  ...overrides,
})
const client = () => ({ release: vi.fn() }) as unknown as pg.PoolClient

type ConnectCallback = (err?: Error, client?: pg.PoolClient, release?: unknown) => void
/** A pool whose `connect` is an own property, answering both overloads. */
function fakePool(connect: (callback?: ConnectCallback) => unknown) {
  return { connect: vi.fn(connect) } as unknown as pg.Pool & { connect: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  mocks.createLoan.mockReset()
  mocks.discard.mockReset()
  mocks.discard.mockResolvedValue(undefined)
})

describe('installTestOwnedPostgresPoolProxy', () => {
  function install(pool: pg.Pool, overrides: Record<string, unknown> = {}) {
    const actionScope = new AsyncLocalStorage<object>()
    const token = {}
    const captured = Promise.withResolvers<Loan>()
    captured.promise.catch(() => undefined)
    const input = {
      pool,
      actionScope,
      token,
      requireOpen: () => undefined,
      isClosed: () => false,
      closedReason: new Error('closed'),
      targetLock: {},
      operationRegistered: Promise.resolve({ outcome: Promise.resolve([]) }),
      captured,
      pendingConnects: [] as Promise<pg.PoolClient>[],
      loans: [] as Loan[],
      ...overrides,
    }
    const restore = installTestOwnedPostgresPoolProxy(input as never)
    return { actionScope, token, captured, input, restore }
  }

  it('passes unowned callers through untouched', async () => {
    const pool = fakePool(() => Promise.resolve(client()))
    const original = pool.connect
    const { restore } = install(pool)
    await pool.connect()
    expect(original).toHaveBeenCalledTimes(1)
    restore()
    expect(pool.connect).toBe(original)
  })

  it('treats a request the callback claims as owned', async () => {
    const leased = client()
    mocks.createLoan.mockReturnValue(loanOf())
    const pool = fakePool(() => Promise.resolve(leased))
    install(pool, { requestId: 'req', isOwnedRequest: (id: string) => id === 'req' })
    expect(await pool.connect()).toBe(leased)
    expect(mocks.createLoan).toHaveBeenCalledTimes(1)
  })

  it('removes an inherited connect on restore', () => {
    const pool = Object.create({ connect: () => Promise.resolve(client()) }) as pg.Pool
    const { restore } = install(pool)
    expect(Object.hasOwn(pool, 'connect')).toBe(true)
    restore()
    expect(Object.hasOwn(pool, 'connect')).toBe(false)
  })

  it('hands the callback checkout back once the loan is ready', async () => {
    const leased = client()
    mocks.createLoan.mockReturnValue(loanOf())
    const pool = fakePool((callback) => callback?.(undefined, leased, leased.release))
    const { actionScope, token } = install(pool)
    const done = Promise.withResolvers<pg.PoolClient | undefined>()
    actionScope.run(token, () =>
      pool.connect((_err: Error | undefined, ready) => done.resolve(ready)),
    )
    expect(await done.promise).toBe(leased)
  })

  it('passes a callback connect error straight through', async () => {
    const failure = new Error('connect failed')
    const pool = fakePool((callback) => callback?.(failure))
    const { actionScope, token } = install(pool)
    const done = Promise.withResolvers<Error | undefined>()
    actionScope.run(token, () => pool.connect((err: Error | undefined) => done.resolve(err)))
    expect(await done.promise).toBe(failure)
  })

  it('reports a failed loan to the callback, aggregating a failed cleanup', async () => {
    const setup = new Error('setup failed')
    const cleanup = new Error('cleanup failed')
    mocks.createLoan.mockReturnValue(
      loanOf({ ready: Promise.reject(setup), dispose: () => Promise.reject(cleanup) }),
    )
    const pool = fakePool((callback) => callback?.(undefined, client()))
    const { actionScope, token, captured } = install(pool)
    const done = Promise.withResolvers<Error | undefined>()
    actionScope.run(token, () => pool.connect((err: Error | undefined) => done.resolve(err)))
    const reported = (await done.promise) as AggregateError
    expect(reported.errors).toEqual([setup, cleanup])
    await expect(captured.promise).rejects.toBe(reported)
  })

  it('discards the checkout when the loan could not be created', async () => {
    const setup = new Error('no loan')
    mocks.createLoan.mockImplementation(() => {
      throw setup
    })
    const pool = fakePool((callback) => callback?.(undefined, client()))
    const { actionScope, token } = install(pool)
    const done = Promise.withResolvers<Error | undefined>()
    actionScope.run(token, () => pool.connect((err: Error | undefined) => done.resolve(err)))
    expect(await done.promise).toBe(setup)
    expect(mocks.discard).toHaveBeenCalledTimes(1)
  })

  it('aggregates a failed discard after a failed loan creation', async () => {
    const setup = new Error('no loan')
    const cleanup = new Error('discard failed')
    mocks.createLoan.mockImplementation(() => {
      throw setup
    })
    mocks.discard.mockRejectedValue(cleanup)
    const pool = fakePool((callback) => callback?.(undefined, client()))
    const { actionScope, token } = install(pool)
    const done = Promise.withResolvers<Error | undefined>()
    actionScope.run(token, () => pool.connect((err: Error | undefined) => done.resolve(err)))
    expect(((await done.promise) as AggregateError).errors).toEqual([setup, cleanup])
  })

  it('captures an error thrown by the callback in both outcomes', async () => {
    const thrown = new Error('callback threw')
    mocks.createLoan.mockReturnValue(loanOf())
    const okPool = fakePool((callback) => callback?.(undefined, client()))
    const ok = install(okPool)
    ok.actionScope.run(ok.token, () =>
      okPool.connect(() => {
        throw thrown
      }),
    )
    await expect(ok.captured.promise).rejects.toBe(thrown)

    mocks.createLoan.mockReturnValue(loanOf({ ready: Promise.reject(new Error('bad')) }))
    const badPool = fakePool((callback) => callback?.(undefined, client()))
    const bad = install(badPool)
    bad.actionScope.run(bad.token, () =>
      badPool.connect(() => {
        throw thrown
      }),
    )
    await expect(bad.captured.promise).rejects.toThrow('bad')
  })

  it('discards a checkout that arrives after the observation closed', async () => {
    const closedReason = new Error('closed')
    const pool = fakePool(() => Promise.resolve(client()))
    const { actionScope, token } = install(pool, { isClosed: () => true, closedReason })
    await expect(actionScope.run(token, () => pool.connect())).rejects.toBe(closedReason)
    expect(mocks.discard).toHaveBeenCalledTimes(1)
  })
})

describe('installTestPostgresMultiWaitPoolProxy', () => {
  function makeState(pool: pg.Pool, token: object) {
    const captured = Promise.withResolvers<Loan>()
    captured.promise.catch(() => undefined)
    return {
      token,
      options: { pool, notice: undefined },
      setup: Promise.resolve({}),
      captured,
      witnessed: false,
    } as never as {
      token: object
      captured: typeof captured
      claimed?: boolean
      loan?: Loan
      pendingConnect?: Promise<pg.PoolClient>
    }
  }
  function install(pool: pg.Pool, overrides: { isClosed?: () => boolean } = {}) {
    const actionScope = new AsyncLocalStorage<object>()
    const token = {}
    const state = makeState(pool, token)
    const closedReason = new Error('closed')
    const restore = installTestPostgresMultiWaitPoolProxy(
      [pool],
      [state as never],
      actionScope,
      overrides.isClosed ?? (() => false),
      closedReason,
    )
    return { actionScope, token, state, restore, closedReason }
  }

  it('leaves unrelated callers alone and restores the pool', async () => {
    const pool = fakePool(() => Promise.resolve(client()))
    const original = pool.connect
    const { restore } = install(pool)
    await pool.connect()
    expect(original).toHaveBeenCalledTimes(1)
    restore()
    restore()
    expect(pool.connect).toBe(original)
  })

  it('removes an inherited connect on restore', () => {
    const pool = Object.create({ connect: () => Promise.resolve(client()) }) as pg.Pool
    const { restore } = install(pool)
    restore()
    expect(Object.hasOwn(pool, 'connect')).toBe(false)
  })

  it('aggregates restoration failures from several pools', () => {
    const failing = (message: string) => {
      const pool = fakePool(() => undefined)
      const { restore } = (() => {
        const actionScope = new AsyncLocalStorage<object>()
        return {
          restore: installTestPostgresMultiWaitPoolProxy(
            [pool],
            [],
            actionScope,
            () => false,
            new Error('c'),
          ),
        }
      })()
      Object.defineProperty(pool, 'connect', {
        configurable: false,
        value: pool.connect,
        writable: false,
      })
      return { restore, message }
    }
    const { restore } = failing('stuck')
    expect(restore).toThrow('restoration failed')
  })

  it('refuses a checkout requested after the observation closed', () => {
    const pool = fakePool(() => Promise.resolve(client()))
    const { actionScope, token, closedReason } = install(pool, { isClosed: () => true })
    expect(() => actionScope.run(token, () => pool.connect())).toThrow(closedReason)
  })

  it('discards a late promise checkout and rejects with the closed reason', async () => {
    let closed = false
    const pool = fakePool(() => Promise.resolve(client()))
    const { actionScope, token, closedReason } = install(pool, { isClosed: () => closed })
    const pending = actionScope.run(token, () => pool.connect())
    closed = true
    await expect(pending).rejects.toBe(closedReason)
    expect(mocks.discard).toHaveBeenCalledTimes(1)
  })

  it('captures the loan on the promise overload', async () => {
    const leased = client()
    const loan = loanOf()
    mocks.createLoan.mockReturnValue(loan)
    const pool = fakePool(() => Promise.resolve(leased))
    const { actionScope, token, state } = install(pool)
    expect(await actionScope.run(token, () => pool.connect())).toBe(leased)
    expect(await state.captured.promise).toBe(loan)
  })

  it('reports callback outcomes: success, connect error, and failed loan with cleanup failure', async () => {
    const leased = client()
    mocks.createLoan.mockReturnValue(loanOf())
    const okPool = fakePool((callback) => callback?.(undefined, leased, leased.release))
    const ok = install(okPool)
    const okDone = Promise.withResolvers<pg.PoolClient | undefined>()
    ok.actionScope.run(ok.token, () =>
      okPool.connect((_err: Error | undefined, ready: pg.PoolClient) => okDone.resolve(ready)),
    )
    expect(await okDone.promise).toBe(leased)

    const failure = new Error('connect failed')
    const errPool = fakePool((callback) => callback?.(failure))
    const withError = install(errPool)
    const errDone = Promise.withResolvers<Error | undefined>()
    withError.actionScope.run(withError.token, () =>
      errPool.connect((err: Error | undefined) => errDone.resolve(err)),
    )
    expect(await errDone.promise).toBe(failure)
    await expect(withError.state.captured.promise).rejects.toBe(failure)

    const setup = new Error('setup failed')
    const cleanup = new Error('cleanup failed')
    mocks.createLoan.mockReturnValue(
      loanOf({ ready: Promise.reject(setup), dispose: () => Promise.reject(cleanup) }),
    )
    const badPool = fakePool((callback) => callback?.(undefined, client()))
    const bad = install(badPool)
    const badDone = Promise.withResolvers<Error | undefined>()
    bad.actionScope.run(bad.token, () =>
      badPool.connect((err: Error | undefined) => badDone.resolve(err)),
    )
    expect(((await badDone.promise) as AggregateError).errors).toEqual([setup, cleanup])
  })

  it('aggregates a failed discard after loan creation throws, and captures callback throws', async () => {
    const setup = new Error('no loan')
    const cleanup = new Error('discard failed')
    mocks.createLoan.mockImplementation(() => {
      throw setup
    })
    mocks.discard.mockRejectedValue(cleanup)
    const pool = fakePool((callback) => callback?.(undefined, client()))
    const first = install(pool)
    const done = Promise.withResolvers<Error | undefined>()
    first.actionScope.run(first.token, () =>
      pool.connect((err: Error | undefined) => done.resolve(err)),
    )
    expect(((await done.promise) as AggregateError).errors).toEqual([setup, cleanup])

    const thrown = new Error('callback threw')
    const failing = fakePool((callback) => callback?.(undefined, client()))
    const second = install(failing)
    second.actionScope.run(second.token, () =>
      failing.connect(() => {
        throw thrown
      }),
    )
    await expect(second.state.captured.promise).rejects.toThrow('setup failed')

    mocks.createLoan.mockReturnValue(loanOf())
    const okPool = fakePool((callback) => callback?.(undefined, client()))
    const third = install(okPool)
    third.actionScope.run(third.token, () =>
      okPool.connect(() => {
        throw thrown
      }),
    )
    await expect(third.state.captured.promise).resolves.toBeDefined()
  })

  it('rethrows the setup failure when the loan disposes cleanly', async () => {
    const setup = new Error('setup failed')
    mocks.createLoan.mockReturnValue(loanOf({ ready: Promise.reject(setup) }))
    const pool = fakePool(() => Promise.resolve(client()))
    const { actionScope, token } = install(pool)
    await expect(actionScope.run(token, () => pool.connect())).rejects.toBe(setup)
  })

  it('rolls back installed pools when a later pool cannot be instrumented', () => {
    const good = fakePool(() => undefined)
    const original = good.connect
    const frozen = Object.freeze(fakePool(() => undefined))
    const actionScope = new AsyncLocalStorage<object>()
    expect(() =>
      installTestPostgresMultiWaitPoolProxy(
        [good, frozen],
        [],
        actionScope,
        () => false,
        new Error('c'),
      ),
    ).toThrow(TypeError)
    expect(good.connect).toBe(original)
  })

  it('aggregates the setup failure with a failed rollback', () => {
    let defines = 0
    const stubborn = new Proxy(
      fakePool(() => undefined),
      {
        defineProperty(target, key, descriptor) {
          if (++defines > 1) throw new Error('rollback failed')
          return Reflect.defineProperty(target, key, descriptor)
        },
      },
    )
    const frozen = Object.freeze(fakePool(() => undefined))
    const actionScope = new AsyncLocalStorage<object>()
    expect(() =>
      installTestPostgresMultiWaitPoolProxy(
        [stubborn, frozen],
        [],
        actionScope,
        () => false,
        new Error('c'),
      ),
    ).toThrow('proxy setup failed')
  })

  it('passes an empty callback result straight through', () => {
    const pool = fakePool((callback) => callback?.())
    const { actionScope, token } = install(pool)
    const seen = vi.fn()
    actionScope.run(token, () => pool.connect(seen))
    expect(seen).toHaveBeenCalledWith(undefined, undefined, undefined)
  })

  it('refuses a loan that finished after the observation closed', async () => {
    let closed = false
    const closedReason = new Error('closed late')
    mocks.createLoan.mockImplementation(() =>
      loanOf({
        ready: Promise.resolve().then(() => {
          closed = true
        }),
      }),
    )
    const pool = fakePool(() => Promise.resolve(client()))
    const actionScope = new AsyncLocalStorage<object>()
    const token = {}
    const state = makeState(pool, token)
    installTestPostgresMultiWaitPoolProxy(
      [pool],
      [state as never],
      actionScope,
      () => closed,
      closedReason,
    )
    await expect(actionScope.run(token, () => pool.connect())).rejects.toBe(closedReason)
  })
})
