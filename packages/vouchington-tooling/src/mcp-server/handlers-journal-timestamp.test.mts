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
const LATER = new Date(Date.parse(NOW) + TEN_MINUTES).toISOString()
const INTERACTIVE = { ...JOURNAL_ARGS, mode: 'interactive' }

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

  it('reuses the recorded timestamp when a delivered append is retried later', async () => {
    const h = harness(fixture())
    await h.call('journal_append', JOURNAL_ARGS)
    clock.advance(TEN_MINUTES)
    const retry = jsonOf(await h.call('journal_append', JOURNAL_ARGS))
    expect(retry).toMatchObject({ status: 'delivered', timestamp: NOW })
    expect(h.fake.calls.append).toHaveLength(1)
    expect(h.fake.calls.get[0]).toEqual({ sessionId: 'native:owner', format: 'jsonl' })
  })

  it('keeps a retained interactive record idempotent across a server restart', async () => {
    const offline = harness(fixture(), { env: {} })
    const pending = jsonOf(await offline.call('journal_append', INTERACTIVE))
    expect(pending).toMatchObject({ status: 'pending', timestamp: NOW, pendingCount: 1 })

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

  it('finds the timestamp on the remote session once the outbox no longer holds it', async () => {
    const first = harness(fixture())
    await first.call('journal_append', INTERACTIVE)
    expect(existsSync(outboxPath(fixture().main))).toBe(true)

    clock.advance(TEN_MINUTES)
    const restarted = harness(fixture(), { entries: first.fake.stored })
    const retry = jsonOf(await restarted.call('journal_append', INTERACTIVE))
    expect(retry).toMatchObject({ status: 'delivered', timestamp: NOW, pendingCount: 0 })
    expect(restarted.fake.calls.append).toEqual([])
  })

  it('still rejects a changed envelope under a delivered sourceEventId', async () => {
    const h = harness(fixture())
    await h.call('journal_append', INTERACTIVE)
    clock.advance(TEN_MINUTES)
    const changed = await h.call('journal_append', { ...INTERACTIVE, markdown: 'A different note' })
    expect(changed.isError).toBe(true)
    expect(textOf(changed)).toContain('event-conflict')
    expect(textOf(changed)).toContain('use a new sourceEventId')
    expect(h.fake.calls.append).toHaveLength(1)
  })

  it('still rejects a changed envelope under a retained sourceEventId', async () => {
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

  it("does not borrow another session's retained timestamp", async () => {
    const offline = harness(fixture(), { env: {} })
    await offline.call('journal_append', { ...INTERACTIVE, sessionId: 'native:other' })
    clock.advance(TEN_MINUTES)
    const own = jsonOf(await offline.call('journal_append', INTERACTIVE))
    expect(own).toMatchObject({ timestamp: LATER, pendingCount: 1, worktreePendingCount: 2 })
  })

  it('mints its own timestamp when the remote lookup cannot run offline', async () => {
    const offline = harness(fixture(), { env: {} })
    const pending = jsonOf(await offline.call('journal_append', INTERACTIVE))
    expect(pending).toMatchObject({ status: 'pending', diagnostic: 'configuration-invalid' })
    expect(pending.timestamp).toBe(NOW)
    expect(offline.fake.calls.get).toEqual([])
  })
})
