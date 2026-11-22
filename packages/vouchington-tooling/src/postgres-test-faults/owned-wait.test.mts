import { AsyncResource } from 'node:async_hooks'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { withTestOwnedPostgresWait } from './owned-wait.mts'
import { ADVISORY_SQL, WAITER_SQL, createFixture } from './owned-wait.test-helpers.mts'
import { tryStartTestCluster, type TestCluster } from './test-cluster.test-helpers.mts'

const started = await tryStartTestCluster()
const MARKER = '/* owned-waiter */'

describe.skipIf(!started)('withTestOwnedPostgresWait (real PostgreSQL)', () => {
  afterAll(() => started?.stop())
  let fixture: Awaited<ReturnType<typeof createFixture>>
  afterEach(() => fixture?.cleanup())
  const setup = async () => (fixture = await createFixture(started as TestCluster))
  const advisory = { kind: 'advisory', key: 'owned-wait' } as const

  it('witnesses a pool.query that queues behind an advisory lock', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    const result = await withTestOwnedPostgresWait(
      options(held, { lock: advisory }),
      async (waitForLock) => {
        const operation = pool.query({ text: `${MARKER} ${WAITER_SQL}` })
        await waitForLock(operation)
        await held.release()
        await operation
        return 'witnessed'
      },
    )
    expect(result).toBe('witnessed')
    expect(Object.getOwnPropertyDescriptor(pool, 'connect')).toBeUndefined()
  })

  it('witnesses a promise checkout against a shared holder, then a shared waiter', async () => {
    const { pool, holder, options } = await setup()
    const shared = await holder(["SELECT pg_advisory_lock_shared(7, hashtext('owned-wait'))"])
    await withTestOwnedPostgresWait(
      options(shared, {
        lock: { kind: 'advisory', key: 'owned-wait', namespace: 7, holderMode: 'shared' },
      }),
      async (waitForLock) => {
        const client = await pool.connect()
        const operation = client
          .query(`${MARKER} SELECT pg_advisory_xact_lock(7, hashtext('owned-wait'))`)
          .finally(() => client.release(true))
        await waitForLock(operation)
        await shared.release()
        await operation
      },
    )
    const exclusive = await holder([ADVISORY_SQL])
    await withTestOwnedPostgresWait(
      options(exclusive, { lock: { ...advisory, waiterMode: 'shared' } }),
      async (waitForLock) => {
        const operation = pool.query({
          text: `${MARKER} SELECT pg_advisory_xact_lock_shared(hashtextextended('owned-wait', 0))`,
        })
        await waitForLock(operation)
        await exclusive.release()
        await operation
      },
    )
  })

  it('witnesses a 32-bit key and a relation lock', async () => {
    const { pool, holder, options } = await setup()
    const keyHolder = await holder(["SELECT pg_advisory_lock(hashtext('owned-wait'))"])
    await withTestOwnedPostgresWait(
      options(keyHolder, {
        lock: { kind: 'advisory32', key: 'owned-wait', waiterMode: 'exclusive' },
      }),
      async (waitForLock) => {
        const operation = pool.query({
          text: `${MARKER} SELECT pg_advisory_xact_lock(hashtext('owned-wait'))`,
        })
        await waitForLock(operation)
        await keyHolder.release()
        await operation
      },
    )
    const relationHolder = await holder([
      'BEGIN',
      'LOCK TABLE owned_wait_rows IN ACCESS EXCLUSIVE MODE',
    ])
    await withTestOwnedPostgresWait(
      options(relationHolder, {
        lock: { kind: 'relation', name: 'owned_wait_rows', waiterMode: 'AccessShareLock' },
      }),
      async (waitForLock) => {
        const operation = pool.query({ text: `${MARKER} SELECT * FROM owned_wait_rows` })
        await waitForLock(operation)
        await relationHolder.release()
        await operation
      },
    )
  })

  it('witnesses a row-lock conflict through the holder transaction id', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder(['BEGIN', 'UPDATE owned_wait_rows SET v = 1 WHERE id = 1'])
    await withTestOwnedPostgresWait(
      options(held, { lock: { kind: 'transaction' } }),
      async (waitForLock) => {
        const operation = pool.query({
          text: `${MARKER} UPDATE owned_wait_rows SET v = 2 WHERE id = 1`,
        })
        await waitForLock(operation)
        await held.release()
        await operation
      },
    )
  })

  it('owns a checkout made outside the action context through the request id', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    const outside = AsyncResource.bind(() =>
      pool.query({ text: `${MARKER} ${WAITER_SQL}` }).catch((err: unknown) => err),
    )
    await withTestOwnedPostgresWait(
      options(held, { lock: advisory, requestId: 'req-1', isOwnedRequest: (id) => id === 'req-1' }),
      async (waitForLock) => {
        const operation = Promise.resolve().then(() => outside())
        await waitForLock(operation)
        await held.release()
        await operation
      },
    )
  })

  it('leaves unrelated checkouts untouched', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    const unrelated = AsyncResource.bind(() => pool.query('SELECT 1 AS one'))
    await withTestOwnedPostgresWait(options(held, { lock: advisory }), async (waitForLock) => {
      const operation = pool.query({ text: `${MARKER} ${WAITER_SQL}` })
      await waitForLock(operation)
      await held.release()
      await operation
    })
    expect((await unrelated()).rows).toEqual([{ one: 1 }])
  })

  it('fails when the action settles without waiting', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    await expect(
      withTestOwnedPostgresWait(options(held, { lock: advisory }), async (waitForLock) => {
        await waitForLock(pool.query('SELECT 1'))
      }),
    ).rejects.toThrow('Owned action settled without its native lock wait')
  })

  it('fails when the action never registers its wait', async () => {
    const { holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    await expect(
      withTestOwnedPostgresWait(options(held, { lock: advisory }), async () => 'skipped'),
    ).rejects.toThrow('Owned action omitted its native lock witness')
  })

  it('rejects registering the wait twice', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    await expect(
      withTestOwnedPostgresWait(options(held, { lock: advisory }), async (waitForLock) => {
        const operation = pool.query({ text: `${MARKER} ${WAITER_SQL}` })
        const first = waitForLock(operation)
        await expect(waitForLock(operation)).rejects.toThrow('registered more than once')
        await first
        await held.release()
        await operation
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects a holder that does not report the identified lock', async () => {
    const { holder, options } = await setup()
    const held = await holder([])
    await expect(
      withTestOwnedPostgresWait(options(held, { lock: advisory }), async () => undefined),
    ).rejects.toThrow('did not report exactly the expected advisory lock')
    const bare = await holder([])
    await expect(
      withTestOwnedPostgresWait(
        options(bare, {
          lock: { kind: 'relation', name: 'owned_wait_rows', waiterMode: 'AccessShareLock' },
        }),
        async () => undefined,
      ),
    ).rejects.toThrow('exactly the expected relation lock')
    await expect(
      withTestOwnedPostgresWait(
        options(bare, { lock: { kind: 'transaction' } }),
        async () => undefined,
      ),
    ).rejects.toThrow('exactly one granted transaction identity')
  })

  it('reports a failing action and a failing holder release together', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    const error = await withTestOwnedPostgresWait(
      options(held, {
        lock: advisory,
        releaseHolder: async () => {
          await held.release()
          throw new Error('release failed')
        },
      }),
      async (waitForLock) => {
        const operation = pool.query({ text: `${MARKER} ${WAITER_SQL}` })
        await waitForLock(operation)
        throw new Error('action failed')
      },
    ).catch((err: unknown) => err as AggregateError)
    expect(error).toBeInstanceOf(AggregateError)
    expect(error.errors.map((err: Error) => err.message)).toEqual([
      'action failed',
      'release failed',
    ])
  })
})
