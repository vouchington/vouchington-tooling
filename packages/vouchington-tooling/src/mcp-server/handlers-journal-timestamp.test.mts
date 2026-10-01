import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  JOURNAL_ARGS,
  NOW,
  harness,
  jsonOf,
  outboxPath,
  textOf,
  useFixedClock,
  useRepoFixture,
} from './harness.test-helpers.mts'

const fixture = useRepoFixture()
const clock = useFixedClock()

const TEN_MINUTES = 10 * 60_000
const EARLIER = new Date(Date.parse(NOW) - TEN_MINUTES).toISOString()
const LATER = new Date(Date.parse(NOW) + TEN_MINUTES).toISOString()
const INTERACTIVE = { ...JOURNAL_ARGS, mode: 'interactive' }

/** An entry as the provider stores it for `JOURNAL_ARGS`, written at `timestamp`. */
function stored(timestamp: string, createdAt: string, markdown = JOURNAL_ARGS.markdown) {
  return {
    createdAt,
    data: {
      schemaVersion: 1,
      type: 'journal',
      sourceEventId: 'journal:1',
      timestamp,
      repositories: ['owner/repo'],
      markdown,
      workOutcome: 'success',
      feedbackCoverage: { status: 'complete', sources: ['tool-result'], droppedCount: 0 },
    },
  }
}

describe('journal_append timestamp ownership', () => {
  it('refuses a caller-supplied timestamp and writes nothing', async () => {
    const h = harness(fixture())
    const result = await h.call('journal_append', { ...INTERACTIVE, timestamp: NOW })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('unsupported argument(s): timestamp')
    expect(h.fake.calls.get).toEqual([])
    expect(h.fake.calls.append).toEqual([])
    expect(existsSync(outboxPath(fixture().main))).toBe(false)
  })

  it('gives each new event the time of its own first append', async () => {
    const h = harness(fixture())
    const first = jsonOf(await h.call('journal_append', JOURNAL_ARGS))
    clock.advance(TEN_MINUTES)
    const second = jsonOf(
      await h.call('journal_append', { ...JOURNAL_ARGS, sourceEventId: 'journal:2' }),
    )
    expect([first.timestamp, second.timestamp]).toEqual([NOW, LATER])
  })

  it('reports the stored timestamp when a delivered append is retried later', async () => {
    const h = harness(fixture())
    await h.call('journal_append', JOURNAL_ARGS)
    clock.advance(TEN_MINUTES)
    const retry = jsonOf(await h.call('journal_append', JOURNAL_ARGS))
    expect(retry).toMatchObject({
      status: 'delivered',
      timestamp: NOW,
      receipt: { timestamp: NOW },
    })
    expect(h.fake.calls.append).toHaveLength(1)
  })

  it('delivers a retained interactive record with its own timestamp after a server restart', async () => {
    const offline = harness(fixture(), { env: {} })
    const pending = jsonOf(await offline.call('journal_append', INTERACTIVE))
    expect(pending).toMatchObject({ status: 'pending', timestamp: NOW, pendingCount: 1 })
    expect(offline.fake.calls.get).toEqual([])

    // A new server process has no memory of the first call; the outbox on disk is all it has.
    clock.advance(TEN_MINUTES)
    const restarted = harness(fixture())
    const retry = jsonOf(await restarted.call('journal_append', INTERACTIVE))
    expect(retry).toMatchObject({
      status: 'delivered',
      timestamp: NOW,
      pendingCount: 0,
      worktreePendingCount: 0,
    })
    expect(restarted.fake.calls.append).toEqual([
      { sessionId: 'native:owner', data: expect.objectContaining({ timestamp: NOW }) },
    ])
  })

  it("does not borrow another session's retained timestamp", async () => {
    const offline = harness(fixture(), { env: {} })
    await offline.call('journal_append', { ...INTERACTIVE, sessionId: 'native:other' })
    clock.advance(TEN_MINUTES)
    const own = jsonOf(await offline.call('journal_append', INTERACTIVE))
    expect(own).toMatchObject({ timestamp: LATER, pendingCount: 1, worktreePendingCount: 2 })
  })
})

describe('journal_append event identity ignores the timestamp', () => {
  it('drains a retry made while the provider was unreachable instead of conflicting', async () => {
    const online = harness(fixture())
    await online.call('journal_append', INTERACTIVE)
    expect(online.fake.stored).toHaveLength(1)

    // The caller never saw that success, retries, and the provider is unreachable: the retry mints
    // its own timestamp and is retained.
    clock.advance(TEN_MINUTES)
    const offline = harness(fixture(), { env: {} })
    const retry = jsonOf(await offline.call('journal_append', INTERACTIVE))
    expect(retry).toMatchObject({
      status: 'pending',
      timestamp: LATER,
      pendingCount: 1,
      worktreePendingCount: 1,
    })

    // The provider is back and already holds the first write, so the flush recognizes the event.
    const recovered = harness(fixture(), { entries: online.fake.stored })
    const flushed = jsonOf(await recovered.call('outbox_flush', { sessionId: 'native:owner' }))
    expect(flushed).toEqual({
      sessionId: 'native:owner',
      status: 'empty',
      pendingCount: 0,
      worktreePendingCount: 0,
      deliveredCount: 1,
    })
    expect(recovered.fake.calls.append).toEqual([])
    expect(recovered.fake.stored).toHaveLength(1)
    const again = jsonOf(await recovered.call('journal_append', INTERACTIVE))
    expect(again).toMatchObject({ status: 'delivered', timestamp: NOW, pendingCount: 0 })
  })

  it('reports the stored timestamp and drops the retained duplicate when both exist', async () => {
    const offline = harness(fixture(), { env: {} })
    await offline.call('journal_append', INTERACTIVE)
    const recovered = harness(fixture(), { entries: [stored(EARLIER, NOW)] })
    const retry = jsonOf(await recovered.call('journal_append', INTERACTIVE))
    expect(retry).toMatchObject({
      status: 'delivered',
      timestamp: EARLIER,
      pendingCount: 0,
      worktreePendingCount: 0,
    })
    expect(recovered.fake.calls.append).toEqual([])
  })

  it('recognizes an autonomous write that differs from the retry only in timestamp', async () => {
    const h = harness(fixture(), { entries: [stored(EARLIER, NOW)] })
    const result = jsonOf(await h.call('journal_append', JOURNAL_ARGS))
    expect(result).toMatchObject({ status: 'delivered', timestamp: EARLIER })
    expect(h.fake.calls.append).toEqual([])
  })

  it('accepts an autonomous write that lands between the read and the append', async () => {
    const h = harness(fixture(), { lateEntry: stored(EARLIER, EARLIER) })
    const result = jsonOf(await h.call('journal_append', JOURNAL_ARGS))
    // The late write is the earliest stored record of the event, so its timestamp is the one
    // reported, and a later retry reports the same one.
    expect(result).toMatchObject({ status: 'delivered', timestamp: EARLIER })
    expect(h.fake.stored.map((entry) => (entry.data as { timestamp: string }).timestamp)).toEqual([
      EARLIER,
      NOW,
    ])
    clock.advance(TEN_MINUTES)
    const retry = jsonOf(await h.call('journal_append', JOURNAL_ARGS))
    expect(retry).toMatchObject({ status: 'delivered', timestamp: EARLIER })
    expect(h.fake.calls.append).toHaveLength(1)
  })

  it('still rejects different content under a delivered sourceEventId', async () => {
    const h = harness(fixture())
    await h.call('journal_append', INTERACTIVE)
    clock.advance(TEN_MINUTES)
    const changed = await h.call('journal_append', { ...INTERACTIVE, markdown: 'A different note' })
    expect(changed.isError).toBe(true)
    expect(textOf(changed)).toContain('event-conflict')
    expect(textOf(changed)).toContain('use a new sourceEventId')
    expect(h.fake.calls.append).toHaveLength(1)
  })

  it('still rejects different content under a retained sourceEventId', async () => {
    const offline = harness(fixture(), { env: {} })
    await offline.call('journal_append', INTERACTIVE)
    clock.advance(TEN_MINUTES)
    const changed = await offline.call('journal_append', {
      ...INTERACTIVE,
      markdown: 'A different note',
    })
    expect(changed.isError).toBe(true)
    expect(textOf(changed)).toContain('conflicts with a retained unsent record')
    const status = jsonOf(await offline.call('outbox_status', { sessionId: 'native:owner' }))
    expect(status).toMatchObject({ pendingCount: 1, worktreePendingCount: 1 })
  })

  it('still rejects a stored event whose content and timestamp both differ', async () => {
    const h = harness(fixture(), { entries: [stored(EARLIER, NOW, 'A note someone else wrote')] })
    const changed = await h.call('journal_append', JOURNAL_ARGS)
    expect(changed.isError).toBe(true)
    expect(textOf(changed)).toContain('event-conflict')
    expect(h.fake.calls.append).toEqual([])
  })
})
