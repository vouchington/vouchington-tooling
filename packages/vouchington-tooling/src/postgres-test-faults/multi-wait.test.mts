import { AsyncResource } from 'node:async_hooks'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createTestPostgresMultiWait } from './multi-wait.mts'
import { ADVISORY_SQL, WAITER_SQL, createFixture } from './owned-wait.test-helpers.mts'
import { tryStartTestCluster, type TestCluster } from './test-cluster.test-helpers.mts'

const started = await tryStartTestCluster()
const MARKER = '/* owned-waiter */'
const advisory = { kind: 'advisory', key: 'owned-wait' } as const

describe.skipIf(!started)('createTestPostgresMultiWait (real PostgreSQL)', () => {
  afterAll(() => started?.stop())
  let fixture: Awaited<ReturnType<typeof createFixture>>
  afterEach(() => fixture?.cleanup())
  const setup = async () => (fixture = await createFixture(started as TestCluster))

  it('witnesses two waiters on two locks and reports their process ids', async () => {
    const { pool, holder, options } = await setup()
    const first = await holder([ADVISORY_SQL])
    const second = await holder(['BEGIN', 'UPDATE owned_wait_rows SET v = 1 WHERE id = 1'])
    await using multi = await createTestPostgresMultiWait([pool])
    const one = await multi.start(options(first, { lock: advisory }), () =>
      pool.query({ text: `${MARKER} ${WAITER_SQL}` }),
    )
    const two = await multi.start(options(second, { lock: { kind: 'transaction' } }), async () => {
      const client = await pool.connect()
      try {
        return await client.query({
          text: `${MARKER} UPDATE owned_wait_rows SET v = 3 WHERE id = 1`,
        })
      } finally {
        client.release()
      }
    })
    await one.waitForLock()
    await two.waitForLock()
    const ids = [await one.waiterProcessId(), await two.waiterProcessId()]
    expect(new Set(ids).size).toBe(2)
    await first.release()
    await second.release()
    await Promise.all([one.operation, two.operation])
  })

  it('owns a callback checkout through the request id and ignores unrelated ones', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    const outside = AsyncResource.bind(() => pool.query({ text: `${MARKER} ${WAITER_SQL}` }))
    await using multi = await createTestPostgresMultiWait([pool])
    const action = await multi.start(
      options(held, { lock: advisory, requestId: 'req-1', isOwnedRequest: (id) => id === 'req-1' }),
      async () => undefined,
    )
    const operation = Promise.resolve().then(() => outside())
    await Promise.race([operation, new Promise((resolve) => setTimeout(resolve, 300))])
    expect((await pool.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }])
    await held.release()
    await operation
    await expect(action.waitForLock()).rejects.toThrow()
  })

  it('fails the witness when the action settles without waiting', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    const multi = await createTestPostgresMultiWait([pool])
    const action = await multi.start(options(held, { lock: advisory }), () =>
      pool.query('SELECT 1'),
    )
    await expect(action.waitForLock()).rejects.toThrow('settled without reaching its lock')
    await expect(multi[Symbol.asyncDispose]()).resolves.toBeUndefined()
  })

  it('rejects a second witness and a start after disposal', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    const multi = await createTestPostgresMultiWait([pool])
    const action = await multi.start(options(held, { lock: advisory }), () =>
      pool.query({ text: `${MARKER} ${WAITER_SQL}` }),
    )
    await action.waitForLock()
    await expect(action.waitForLock()).rejects.toThrow('requested more than once')
    await held.release()
    await action.operation
    await multi[Symbol.asyncDispose]()
    expect(() => multi.start(options(held, { lock: advisory }), async () => undefined)).toThrow(
      'closed before completion',
    )
  })

  it('surfaces a holder that does not report the identified lock', async () => {
    const { pool, holder, options } = await setup()
    const bare = await holder([])
    const multi = await createTestPostgresMultiWait([pool])
    const action = await multi.start(options(bare, { lock: advisory }), async () => undefined)
    await expect(action.operation).rejects.toThrow(
      'did not report exactly the expected advisory lock',
    )
    await expect(multi[Symbol.asyncDispose]()).resolves.toBeUndefined()
  })
})
