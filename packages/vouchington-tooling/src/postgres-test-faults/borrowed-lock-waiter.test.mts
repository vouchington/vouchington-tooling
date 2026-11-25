import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { createTestPostgresLockWaiter, type TestLockWaiterHolder } from './index.mts'

const SESSION_SETTINGS = {
  process_id: 9001,
  version: 180001,
  role_name: 'tester',
  database_name: 'testdb',
  locale: 'C',
  log_lock_waits: 'off',
  deadlock_timeout: '1s',
  client_min_messages: 'notice',
  statement_timeout: '2s',
  application_name: 'test',
  timeout_ms: 2000,
  can_log: true,
  can_set_deadlock: true,
}

function createFakeNoticeClient(
  options: {
    closeFails?: boolean
    keepPendingQuery?: boolean
  } = {},
) {
  const emitter = new EventEmitter()
  const release = vi.fn((err?: Error) => {
    if (err) queueMicrotask(() => emitter.emit('end'))
  })
  const query = vi.fn(async (input: string | { text: string; values?: unknown[] }) => {
    const text = typeof input === 'string' ? input : input.text
    if (text.includes('observePostgresLockNotice.settings')) {
      return { rows: [SESSION_SETTINGS] }
    }
    if (text.includes('observePostgresLockNotice.restore')) {
      if (options.closeFails) throw new Error('restore settings failed')
      return { rows: [SESSION_SETTINGS] }
    }
    if (options.keepPendingQuery && text.includes('/* target */')) {
      return await new Promise<never>(() => {})
    }
    return { rows: [] }
  })
  const client = Object.assign(emitter, { query, release })
  return { client: client as unknown as pg.PoolClient, emitter, release, query }
}

function createHolder(
  rows: Record<string, unknown>[],
  releaseImpl?: () => Promise<void>,
): TestLockWaiterHolder {
  return {
    query: vi.fn(async () => ({ rows })) as TestLockWaiterHolder['query'],
    release: vi.fn(releaseImpl ?? (async () => undefined)),
  }
}

describe('createTestPostgresLockWaiter', () => {
  it('observes a transaction lock wait and cleans up on async disposal', async () => {
    const { client, emitter, release, query } = createFakeNoticeClient()
    const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool
    const holder = createHolder([{ transaction_id: '777' }])
    const txDispose = vi.fn(async () => {
      // String ROLLBACK query succeeds because lock observation is restored before tx disposal.
      await client.query('ROLLBACK')
    })
    let resolveTarget!: () => void
    ;(client as unknown as { query: unknown }).query = (
      input: string | { text: string; values?: unknown[] },
      values?: unknown[],
    ) => {
      if (typeof input === 'object' && input.text.includes('/* target */')) {
        return new Promise<{ rows: [] }>((resolve) => {
          resolveTarget = () => resolve({ rows: [] })
        })
      }
      return (query as (i: unknown, v?: unknown) => Promise<unknown>)(input, values)
    }

    const tx = {
      run: () => client.query({ text: '/* target */ SELECT 1', values: ['row-1'] }),
      [Symbol.asyncDispose]: txDispose,
    }

    let callerAllowsNotice = false
    const waiter = await createTestPostgresLockWaiter({
      pool,
      holder,
      beginTransaction: async () => tx,
      lock: { kind: 'transaction' },
      selected: { marker: '/* target */', binding: { index: 0, value: 'row-1' } },
      notice: { applicationNamePrefix: 'test-lock', eligible: () => callerAllowsNotice },
    })

    const queryPromise = tx.run()
    let resolveAction!: () => void
    const action = new Promise<void>((resolve) => {
      resolveAction = resolve
    })
    const waitPromise = waiter.waitForLock(action)
    expect(() => waiter.waitForLock(action)).toThrow('accepts one live action')

    // Caller eligible predicate returning false suppresses the notice until allowed.
    let waitSettled = false
    void waitPromise.then(() => {
      waitSettled = true
    })
    emitter.emit('notice', {
      message: 'process 9001 still waiting for ShareLock on transaction 777 after 1.000 ms',
    })
    await Promise.resolve()
    expect(waitSettled).toBe(false)

    callerAllowsNotice = true
    emitter.emit('notice', {
      message: 'process 9001 still waiting for ShareLock on transaction 777 after 1.000 ms',
    })
    await waitPromise
    resolveTarget()
    await queryPromise
    resolveAction()
    await waiter[Symbol.asyncDispose]()
    expect(holder.release).toHaveBeenCalledOnce()
    expect(txDispose).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledWith(undefined)
  })

  it('observes advisory32 and advisory64 lock tags and rejects missing or ambiguous holder locks', async () => {
    for (const kind of ['advisory32', 'advisory64'] as const) {
      const { client } = createFakeNoticeClient()
      const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool
      const holder = createHolder([{ lock_tag: 'advisory lock [1,2,3,1]' }])
      const waiter = await createTestPostgresLockWaiter({
        pool,
        holder,
        beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
        lock: { kind, key: 'lock-key' },
        selected: { marker: '/* adv */', binding: { index: 0, value: 'k' } },
      })
      await waiter[Symbol.asyncDispose]()
      expect(() => waiter.waitForLock(Promise.resolve())).toThrow('accepts one live action')
    }

    const emptyPool = { connect: vi.fn() } as unknown as pg.Pool
    await expect(
      createTestPostgresLockWaiter({
        pool: emptyPool,
        holder: createHolder([]),
        beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
        lock: { kind: 'transaction' },
        selected: { marker: '/* m */', binding: { index: 0, value: 'v' } },
      }),
    ).rejects.toThrow('Owned holder has no PostgreSQL transaction ID')

    await expect(
      createTestPostgresLockWaiter({
        pool: emptyPool,
        holder: createHolder([
          { lock_tag: 'advisory lock [1,2,3,1]' },
          { lock_tag: 'advisory lock [1,2,3,1]' },
        ]),
        beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
        lock: { kind: 'advisory64', key: 'dup' },
        selected: { marker: '/* m */', binding: { index: 0, value: 'v' } },
      }),
    ).rejects.toThrow('Owned holder does not have the exact advisory lock')
  })

  it('aggregates cleanup failures with primary setup failure or rejected action and destroys client', async () => {
    const connectErr = new Error('connect boom')
    const failConnectPool = {
      connect: vi.fn(async () => {
        throw connectErr
      }),
    } as unknown as pg.Pool
    const holderErr = new Error('holder release boom')
    const failingHolder = createHolder([{ transaction_id: '55' }], async () => {
      throw holderErr
    })
    const setupFailure = await createTestPostgresLockWaiter({
      pool: failConnectPool,
      holder: failingHolder,
      beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
      lock: { kind: 'transaction' },
      selected: { marker: '/* m */', binding: { index: 0, value: 'v' } },
    }).catch((err: unknown) => err)
    expect(setupFailure).toBeInstanceOf(AggregateError)
    expect((setupFailure as AggregateError).errors).toEqual([connectErr, holderErr])

    const { client, emitter, release } = createFakeNoticeClient({
      closeFails: true,
      keepPendingQuery: true,
    })
    const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool
    const holder = createHolder([{ transaction_id: '88' }])
    const txDisposeErr = new Error('tx dispose boom')
    const waiter = await createTestPostgresLockWaiter({
      pool,
      holder,
      beginTransaction: async () => ({
        [Symbol.asyncDispose]: async () => {
          throw txDisposeErr
        },
      }),
      lock: { kind: 'transaction' },
      selected: { marker: '/* target */', binding: { index: 0, value: 'v' } },
    })

    void client.query({ text: '/* target */ SELECT 1', values: ['v'] })
    const actionErr = new Error('action boom')
    const rejectedAction = Promise.reject(actionErr)
    void rejectedAction.catch(() => undefined)
    const waiting = waiter.waitForLock(rejectedAction)
    emitter.emit('notice', {
      message: 'process 9001 still waiting for ShareLock on transaction 88 after 1.000 ms',
    })
    await waiting.catch(() => undefined)

    const disposeFailure = await waiter[Symbol.asyncDispose]().catch((err: unknown) => err)
    expect(disposeFailure).toBeInstanceOf(AggregateError)
    expect((disposeFailure as AggregateError).errors.map((err: Error) => err.message)).toEqual([
      'action boom',
      'tx dispose boom',
      'restore settings failed',
      'Owned lock queries did not finish draining',
    ])
    expect(release).toHaveBeenCalledWith(disposeFailure)
  })

  it('releases holder on registerCleanup error, discards client on beginTransaction error, and skips hang on holder release failure', async () => {
    const regHolder = createHolder([{ transaction_id: '11' }])
    await expect(
      createTestPostgresLockWaiter({
        pool: { connect: vi.fn() } as unknown as pg.Pool,
        holder: regHolder,
        beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
        lock: { kind: 'transaction' },
        selected: { marker: '/* m */', binding: { index: 0, value: 'v' } },
        registerCleanup: () => {
          throw new Error('registerCleanup boom')
        },
      }),
    ).rejects.toThrow('registerCleanup boom')
    expect(regHolder.release).toHaveBeenCalledOnce()

    // beginTransaction throwing after connect must discard the borrowed client.
    const { client: txClient, release: txRelease } = createFakeNoticeClient()
    const txHolder = createHolder([{ transaction_id: '22' }])
    await expect(
      createTestPostgresLockWaiter({
        pool: { connect: vi.fn(async () => txClient) } as unknown as pg.Pool,
        holder: txHolder,
        beginTransaction: async () => {
          throw new Error('beginTx boom')
        },
        lock: { kind: 'transaction' },
        selected: { marker: '/* m */', binding: { index: 0, value: 'v' } },
      }),
    ).rejects.toThrow('beginTx boom')
    expect(txRelease).toHaveBeenCalledWith(true)

    // When holder.release() fails while action is blocked forever, dispose does not hang.
    const {
      client: blockedClient,
      emitter: blockedEmitter,
      release: blockedRelease,
    } = createFakeNoticeClient({ keepPendingQuery: true })
    const releaseErr = new Error('holder unlock failed')
    const stuckHolder = createHolder([{ transaction_id: '33' }], async () => {
      throw releaseErr
    })
    const txDisposeSpy = vi.fn(async () => undefined)
    const stuckWaiter = await createTestPostgresLockWaiter({
      pool: { connect: vi.fn(async () => blockedClient) } as unknown as pg.Pool,
      holder: stuckHolder,
      beginTransaction: async () => ({ [Symbol.asyncDispose]: txDisposeSpy }),
      lock: { kind: 'transaction' },
      selected: { marker: '/* target */', binding: { index: 0, value: 'v' } },
    })
    void blockedClient.query({ text: '/* target */ SELECT 1', values: ['v'] })
    const neverAction = new Promise<void>(() => {})
    const waiting = stuckWaiter.waitForLock(neverAction)
    blockedEmitter.emit('notice', {
      message: 'process 9001 still waiting for ShareLock on transaction 33 after 1.000 ms',
    })
    await waiting
    const stuckError = await stuckWaiter[Symbol.asyncDispose]().catch((err: unknown) => err)
    expect(stuckError).toBeInstanceOf(AggregateError)
    expect((stuckError as AggregateError).errors.map((err: Error) => err.message)).toEqual([
      'holder unlock failed',
      'Owned lock queries did not finish draining',
    ])
    expect(txDisposeSpy).not.toHaveBeenCalled()
    expect(blockedRelease).toHaveBeenCalledWith(stuckError)
  })

  it('aborts setup when cleanup runs mid-setup via registerCleanup', async () => {
    const { client } = createFakeNoticeClient()
    let releaseConnect!: () => void
    const pool = {
      connect: vi.fn(
        () =>
          new Promise<pg.PoolClient>((resolve) => {
            releaseConnect = () => resolve(client)
          }),
      ),
    } as unknown as pg.Pool
    let registeredCleanup!: () => Promise<void> | undefined
    const holder = createHolder([{ transaction_id: '99' }])

    const creating = createTestPostgresLockWaiter({
      pool,
      holder,
      beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
      lock: { kind: 'transaction' },
      selected: { marker: '/* target */', binding: { index: 0, value: 'v' } },
      registerCleanup: (fn) => {
        registeredCleanup = fn
      },
    })
    // Wait until pool.connect() has been invoked.
    await Promise.resolve()
    await Promise.resolve()
    const cleanupPromise = registeredCleanup()
    releaseConnect()
    await cleanupPromise
    await expect(creating).rejects.toThrow('Owned PostgreSQL waiter is already closed')
  })
})
