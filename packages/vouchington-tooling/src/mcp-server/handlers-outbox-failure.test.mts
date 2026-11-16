import { readdirSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  JOURNAL_ARGS,
  harness,
  jsonOf,
  outboxPath,
  useRepoFixture,
} from './harness.test-helpers.mts'

const fixture = useRepoFixture()
const OWNER = { ...JOURNAL_ARGS, mode: 'interactive' }
const ARGS = { sessionId: 'native:owner' }
const TOKEN = 'secret-token-value'
const failure = (status: number) => Object.assign(new Error(`HTTP ${status} ${TOKEN}`), { status })

describe('outbox failures and quarantine', () => {
  it('report a non-secret cause per record from outbox_flush and outbox_status', async () => {
    const offline = harness(fixture(), { env: {} })
    await offline.call('journal_append', OWNER)
    const flushed = jsonOf(await offline.call('outbox_flush', ARGS))
    expect(flushed).toMatchObject({
      diagnostic: 'configuration-invalid',
      failures: [
        { sourceEventId: 'journal:1', cause: 'missing-env:AGENT_BLACKBOARD_URL', attempts: 1 },
      ],
    })
    const down = harness(fixture(), { ensureError: failure(503) })
    const unavailable = jsonOf(await down.call('outbox_flush', ARGS))
    expect(unavailable).toMatchObject({
      diagnostic: 'blackboard-unavailable',
      failures: [{ cause: 'http-5xx', httpStatus: 503, attempts: 1 }],
    })
    const status = jsonOf(await down.call('outbox_status', ARGS))
    expect(status.failures).toEqual(unavailable.failures)
    expect(JSON.stringify([flushed, unavailable, status])).not.toContain(TOKEN)
  })

  it('quarantine on the fifth identical failure, then prune the rejection', async () => {
    const offline = harness(fixture(), { env: {} })
    await offline.call('journal_append', OWNER)
    const broken = harness(fixture(), { ensureError: failure(400) })
    for (let attempt = 1; attempt <= 4; attempt++)
      expect(jsonOf(await broken.call('outbox_flush', ARGS))).toMatchObject({
        status: 'pending',
        worktreePendingCount: 1,
        failures: [{ attempts: attempt }],
      })
    const fifth = jsonOf(await broken.call('outbox_flush', ARGS))
    expect(fifth).toMatchObject({
      status: 'empty',
      worktreePendingCount: 0,
      worktreeRejectedCount: 1,
      rejected: [
        { sourceEventId: 'journal:1', diagnostic: 'delivery-quarantined', cause: 'http-4xx' },
      ],
    })
    expect(fifth).not.toHaveProperty('failures')
    expect(jsonOf(await broken.call('outbox_status', ARGS))).toMatchObject({
      rejected: [
        {
          sourceEventId: 'journal:1',
          diagnostic: 'delivery-quarantined',
          cause: 'http-4xx',
          httpStatus: 400,
          attempts: 5,
        },
      ],
    })
    expect(jsonOf(await broken.call('outbox_prune_rejected', ARGS))).toMatchObject({
      prunedCount: 0,
      worktreeRejectedCount: 1,
    })
    const directory = outboxPath(fixture().main)
    const stale = new Date(Date.now() - 8 * 86_400_000)
    for (const name of readdirSync(directory))
      if (name.endsWith('.rejected')) utimesSync(join(directory, name), stale, stale)
    expect(jsonOf(await broken.call('outbox_prune_rejected', ARGS))).toMatchObject({
      prunedCount: 1,
      worktreeRejectedCount: 0,
    })
    expect(jsonOf(await broken.call('outbox_status', ARGS))).not.toHaveProperty('rejected')
  })

  it('prune everything with olderThanDays 0 and reject an invalid age', async () => {
    const broken = harness(fixture(), { env: {}, ensureError: failure(400) })
    await broken.call('journal_append', OWNER)
    expect(
      jsonOf(await broken.call('outbox_prune_rejected', { ...ARGS, olderThanDays: 0 })),
    ).toMatchObject({ prunedCount: 0, worktreePendingCount: 1 })
    const bad = await broken.call('outbox_prune_rejected', { ...ARGS, olderThanDays: -1 })
    expect(bad.isError).toBe(true)
  })
})
