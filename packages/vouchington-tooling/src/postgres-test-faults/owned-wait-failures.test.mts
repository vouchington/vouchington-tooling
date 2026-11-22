import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createTestPostgresMultiWait } from './multi-wait.mts'
import { withTestOwnedPostgresWait } from './owned-wait.mts'
import { ADVISORY_SQL, WAITER_SQL, createFixture } from './owned-wait.test-helpers.mts'
import { tryStartTestCluster, type TestCluster } from './test-cluster.test-helpers.mts'

const started = await tryStartTestCluster()
const MARKER = '/* owned-waiter */'
const advisory = { kind: 'advisory', key: 'owned-wait' } as const
const REJECTED_VERSION = { serverVersionNum: { min: 0, max: 1 } }
const PREREQUISITE = 'requires a supported PostgreSQL version'

describe.skipIf(!started)('owned PostgreSQL waits: failure paths (real PostgreSQL)', () => {
  afterAll(() => started?.stop())
  let fixture: Awaited<ReturnType<typeof createFixture>>
  afterEach(() => fixture?.cleanup())
  const setup = async () => (fixture = await createFixture(started as TestCluster))

  it('fails a promise checkout whose notice prerequisites are not met', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    await expect(
      withTestOwnedPostgresWait(
        options(held, { lock: advisory, notice: REJECTED_VERSION }),
        async () => {
          await pool.connect()
        },
      ),
    ).rejects.toThrow(PREREQUISITE)
  })

  it('fails a callback checkout whose notice prerequisites are not met', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    await expect(
      withTestOwnedPostgresWait(
        options(held, { lock: advisory, notice: REJECTED_VERSION }),
        async (waitForLock) => {
          const operation = pool.query({ text: `${MARKER} ${WAITER_SQL}` })
          await waitForLock(operation)
        },
      ),
    ).rejects.toThrow(PREREQUISITE)
  })

  it('discards a checkout that finishes after the observation closed', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    await expect(
      withTestOwnedPostgresWait(options(held, { lock: advisory }), async () => {
        void pool.connect().then(
          (client) => client.release(true),
          () => undefined,
        )
        pool.connect((_err, client) => client?.release(true))
        throw new Error('stop')
      }),
    ).rejects.toThrow('stop')
  })

  it('refuses an owned checkout made after the observation closed', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    let late: unknown
    await expect(
      withTestOwnedPostgresWait(
        options(held, {
          lock: advisory,
          releaseHolder: async () => {
            await sleep(100)
            await held.release()
          },
        }),
        async () => {
          setTimeout(() => {
            try {
              void pool.connect()
            } catch (err) {
              late = err
            }
          }, 0)
          throw new Error('stop')
        },
      ),
    ).rejects.toThrow('stop')
    expect(late).toMatchObject({ message: 'Owned PostgreSQL observation closed before completion' })
  })

  it('reports a holder release failure from a multi-wait disposal', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    const multi = await createTestPostgresMultiWait([pool])
    const action = await multi.start(
      options(held, {
        lock: advisory,
        releaseHolder: async () => {
          await held.release()
          throw new Error('release failed')
        },
      }),
      () => pool.query({ text: `${MARKER} ${WAITER_SQL}` }),
    )
    await action.waitForLock()
    await expect(multi[Symbol.asyncDispose]()).rejects.toMatchObject({
      message: 'Owned PostgreSQL actions and cleanup failed',
    })
    await action.operation
  })

  it('fails multi-wait checkouts whose notice prerequisites are not met', async () => {
    const { pool, holder, options } = await setup()
    const held = await holder([ADVISORY_SQL])
    const other = await holder([ADVISORY_SQL.replace('owned-wait', 'other-wait')])
    const multi = await createTestPostgresMultiWait([pool])
    const promised = await multi.start(
      options(held, { lock: advisory, notice: REJECTED_VERSION }),
      async () => {
        await pool.connect()
      },
    )
    await expect(promised.waitForLock()).rejects.toThrow(PREREQUISITE)
    await multi[Symbol.asyncDispose]().catch(() => undefined)
    const second = await createTestPostgresMultiWait([pool])
    const called = await second.start(
      options(other, {
        lock: { kind: 'advisory', key: 'other-wait' },
        notice: REJECTED_VERSION,
      }),
      () => pool.query({ text: `${MARKER} SELECT 1` }),
    )
    await expect(called.waitForLock()).rejects.toThrow(PREREQUISITE)
    await expect(called.waiterProcessId()).rejects.toThrow(PREREQUISITE)
    await second[Symbol.asyncDispose]().catch(() => undefined)
  })
})
