import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  JOURNAL_ARGS,
  NOW,
  harness,
  jsonOf,
  outboxPath,
  useFixedClock,
  useRepoFixture,
  type Harness,
} from './harness.test-helpers.mts'

const fixture = useRepoFixture()
useFixedClock()

const OWNER = { ...JOURNAL_ARGS, mode: 'interactive' }
const OTHER = { ...OWNER, sessionId: 'native:other', sourceEventId: 'journal:2' }

/** Two sessions share one worktree: the owner retains two records, the other one. */
async function retainRecords(offline: Harness): Promise<void> {
  await offline.call('journal_append', OWNER)
  await offline.call('journal_append', { ...OWNER, sourceEventId: 'journal:3' })
  await offline.call('journal_append', OTHER)
}

describe('outbox_status and outbox_flush', () => {
  it('report an empty outbox without creating the directory', async () => {
    const h = harness(fixture())
    expect(jsonOf(await h.call('outbox_status', { sessionId: 'x' }))).toEqual({
      sessionId: 'x',
      status: 'empty',
      pendingCount: 0,
      worktreePendingCount: 0,
    })
    expect(jsonOf(await h.call('outbox_flush', { sessionId: 'x' }))).toEqual({
      sessionId: 'x',
      status: 'empty',
      pendingCount: 0,
      worktreePendingCount: 0,
      deliveredCount: 0,
    })
    expect(existsSync(outboxPath(fixture().main))).toBe(false)
  })

  it('count the caller session apart from the whole worktree', async () => {
    const offline = harness(fixture(), { env: {} })
    const first = jsonOf(await offline.call('journal_append', OWNER))
    expect(first).toMatchObject({ pendingCount: 1, worktreePendingCount: 1 })
    const second = jsonOf(await offline.call('journal_append', { ...OWNER, sourceEventId: 'j:3' }))
    expect(second).toMatchObject({ pendingCount: 2, worktreePendingCount: 2 })
    const other = jsonOf(await offline.call('journal_append', OTHER))
    expect(other).toMatchObject({ pendingCount: 1, worktreePendingCount: 3, status: 'pending' })

    const status = async (sessionId: string) =>
      jsonOf(await offline.call('outbox_status', { sessionId }))
    expect(await status('native:owner')).toEqual({
      sessionId: 'native:owner',
      status: 'pending',
      pendingCount: 2,
      worktreePendingCount: 3,
    })
    expect(await status('native:other')).toMatchObject({ pendingCount: 1, worktreePendingCount: 3 })
    expect(await status('x')).toEqual({
      sessionId: 'x',
      status: 'empty',
      pendingCount: 0,
      worktreePendingCount: 3,
    })
  })

  it('flushes retained records once the blackboard is reachable', async () => {
    const offline = harness(fixture(), { env: {} })
    await offline.call('journal_append', OWNER)
    const online = harness(fixture())
    const stillPending = jsonOf(await offline.call('outbox_flush', { sessionId: 'native:owner' }))
    expect(stillPending).toMatchObject({
      status: 'pending',
      pendingCount: 1,
      worktreePendingCount: 1,
      deliveredCount: 0,
      diagnostic: 'configuration-invalid',
    })
    const flushed = jsonOf(await online.call('outbox_flush', { sessionId: 'native:owner' }))
    expect(flushed).toEqual({
      sessionId: 'native:owner',
      status: 'empty',
      pendingCount: 0,
      worktreePendingCount: 0,
      deliveredCount: 1,
    })
    expect(online.fake.calls.append).toHaveLength(1)
    expect(jsonOf(await online.call('outbox_status', { sessionId: 'native:owner' }))).toMatchObject(
      { pendingCount: 0, worktreePendingCount: 0 },
    )
  })

  it('flushes every session in the worktree and reports the totals', async () => {
    const offline = harness(fixture(), { env: {} })
    await retainRecords(offline)
    const online = harness(fixture())
    const flushed = jsonOf(await online.call('outbox_flush', { sessionId: 'x' }))
    expect(flushed).toEqual({
      sessionId: 'x',
      status: 'empty',
      pendingCount: 0,
      worktreePendingCount: 0,
      deliveredCount: 3,
    })
    expect(online.fake.calls.append).toHaveLength(3)
  })

  it('leaves a stuck record counted against its own session only', async () => {
    const offline = harness(fixture(), { env: {} })
    await retainRecords(offline)
    // The remote already holds the owner's journal:1 with different content, so that one record
    // can never be delivered; the others are.
    const conflicting = {
      createdAt: NOW,
      data: {
        schemaVersion: 1,
        type: 'journal',
        sourceEventId: 'journal:1',
        timestamp: NOW,
        repositories: ['owner/repo'],
        markdown: 'A note someone else wrote',
        workOutcome: 'success',
        feedbackCoverage: { status: 'complete', sources: [], droppedCount: 0 },
      },
    }
    const online = harness(fixture(), { entries: [conflicting] })
    const byOther = jsonOf(await online.call('outbox_flush', { sessionId: 'native:other' }))
    expect(byOther).toMatchObject({
      status: 'empty',
      pendingCount: 0,
      worktreePendingCount: 1,
      deliveredCount: 2,
      diagnostic: 'event-conflict',
    })
    const byOwner = jsonOf(await online.call('outbox_status', { sessionId: 'native:owner' }))
    expect(byOwner).toMatchObject({ status: 'pending', pendingCount: 1, worktreePendingCount: 1 })
  })
})
