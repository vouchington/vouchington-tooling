import { mkdtemp, rm } from 'node:fs/promises'
import { readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  QUARANTINE_ATTEMPTS,
  causeOfError,
  configurationCause,
  isTransientCause,
  statusCause,
} from './feedback-failure.mts'
import { parseFailure, parseRejection } from './feedback-failure-parse.mts'
import { readFeedbackFailures } from './feedback-outbox-failure.mts'
import {
  pruneRejectedFeedbackOutbox,
  readRejectedDetails,
  rejectFeedbackOutbox,
} from './feedback-outbox-rejected.mts'
import { createFeedbackEnvelope, flushFeedbackOutbox, writeFeedback } from './index.mts'
import type { BlackboardClientModule } from './index.mts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const TOKEN = 'secret-token-value'
const env = { AGENT_BLACKBOARD_URL: 'https://provider.test', AGENT_BLACKBOARD_TOKEN: TOKEN }
const identity = { sessionId: 'native:owner', parentSessionId: null, agent: 'claude', version: '2' }
const envelope = (sourceEventId: string) =>
  createFeedbackEnvelope({
    schemaVersion: 1,
    type: 'journal',
    sourceEventId,
    timestamp: '2026-01-01T00:00:00.000Z',
    repositories: ['owner/repo'],
    markdown: 'A useful finding',
    workOutcome: 'unknown',
    feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
  })
/** A provider whose session call fails with a fixed error that echoes the token in its message. */
function failing(failure: () => Error) {
  return {
    loadClient: async (): Promise<BlackboardClientModule> => ({
      Sessions: class {
        async ensure(): Promise<never> {
          throw failure()
        }
        async patch() {}
        async list() {}
        async get(): Promise<never> {
          throw failure()
        }
      },
      Entries: class {
        async append(): Promise<{ createdAt: string; data: unknown }> {
          throw failure()
        }
        async *get() {}
      },
    }),
  }
}
const http = (status: number) => () =>
  Object.assign(new Error(`HTTP ${status} ${TOKEN}`), { status })
async function retain(...ids: string[]): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'feedback-failure-'))
  directories.push(path)
  for (const id of ids)
    await writeFeedback({
      identity,
      envelope: envelope(id),
      mode: 'interactive',
      outboxDirectory: path,
      env: {},
    })
  return path
}
const flush = (
  directory: string,
  dependencies = failing(http(503)),
  vars: NodeJS.ProcessEnv = env,
) => flushFeedbackOutbox({ directory, env: vars, dependencies })

describe('delivery causes', () => {
  it('names a 5xx, a network error, and each missing variable apart without secrets', async () => {
    const path = await retain('cause:one')
    const outcomes = [
      await flush(path, failing(http(503))),
      await flush(
        path,
        failing(() => Object.assign(new Error(`connect ${TOKEN}`), { code: 'ECONNREFUSED' })),
      ),
      await flush(path, failing(http(503)), { AGENT_BLACKBOARD_TOKEN: TOKEN }),
      await flush(path, failing(http(503)), { AGENT_BLACKBOARD_URL: env.AGENT_BLACKBOARD_URL }),
    ]
    expect(outcomes.map((outcome) => outcome.failures?.[0])).toEqual([
      { sourceEventId: 'cause:one', cause: 'http-5xx', httpStatus: 503, attempts: 1 },
      { sourceEventId: 'cause:one', cause: 'network', code: 'ECONNREFUSED', attempts: 1 },
      { sourceEventId: 'cause:one', cause: 'missing-env:AGENT_BLACKBOARD_URL', attempts: 1 },
      { sourceEventId: 'cause:one', cause: 'missing-env:AGENT_BLACKBOARD_TOKEN', attempts: 1 },
    ])
    expect(outcomes.map((outcome) => outcome.diagnostic)).toEqual([
      'blackboard-unavailable',
      'blackboard-unavailable',
      'configuration-invalid',
      'configuration-invalid',
    ])
    expect(JSON.stringify([outcomes, readFeedbackFailures(path)])).not.toContain(TOKEN)
  })

  it('classifies raw errors from status, code, and name only', () => {
    expect(causeOfError(Object.assign(new Error('x'), { statusCode: 502 }))).toEqual({
      cause: 'http-5xx',
      httpStatus: 502,
    })
    expect(causeOfError(Object.assign(new Error('x'), { status: 429 }))).toEqual({
      cause: 'http-429',
      httpStatus: 429,
    })
    expect(causeOfError(Object.assign(new Error('x'), { status: 404 })).cause).toBe('http-4xx')
    expect(statusCause(302).cause).toBe('http-other')
    expect(
      causeOfError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })),
    ).toEqual({ cause: 'network', code: 'ENOTFOUND' })
    expect(causeOfError(new TypeError('fetch failed'))).toEqual({ cause: 'network' })
    expect(causeOfError(new RangeError(TOKEN))).toEqual({ cause: 'error:RangeError' })
    expect(causeOfError({ name: 'a b' })).toEqual({ cause: 'error:unknown' })
    expect(causeOfError('text')).toEqual({ cause: 'error:unknown' })
    expect(configurationCause(env)).toEqual({ cause: 'invalid-url' })
    expect(configurationCause({})).toEqual({ cause: 'missing-env:AGENT_BLACKBOARD_URL' })
    expect(isTransientCause('http-5xx')).toBe(true)
    expect(isTransientCause('http-4xx')).toBe(false)
    expect(isTransientCause('error:RangeError')).toBe(false)
  })

  it('validates stored failure and rejection notes', () => {
    expect(parseFailure({ cause: 'network', code: 'ECONNRESET', attempts: 2 })).toEqual({
      cause: 'network',
      code: 'ECONNRESET',
      attempts: 2,
    })
    for (const bad of [
      null,
      { cause: 'network' },
      { cause: 'network', attempts: 0 },
      { cause: 'bad cause', attempts: 1 },
      { cause: 'network', attempts: 1, httpStatus: 99 },
      { cause: 'network', attempts: 1, code: 'lower' },
    ])
      expect(() => parseFailure(bad)).toThrow(/invalid feedback outbox failure/)
    expect(parseRejection({ diagnostic: 'event-conflict' })).toEqual({
      diagnostic: 'event-conflict',
    })
    for (const bad of [null, { diagnostic: 7 }, { diagnostic: 'x', attempts: 'many' }])
      expect(() => parseRejection(bad)).toThrow(/invalid feedback outbox rejection/)
  })
})

describe('quarantine', () => {
  it('keeps a record pending for four identical failures and quarantines the fifth', async () => {
    const path = await retain('quarantine:one')
    const dependencies = failing(http(400))
    for (let attempt = 1; attempt < QUARANTINE_ATTEMPTS; attempt++) {
      const result = await flush(path, dependencies)
      expect(result).toMatchObject({ status: 'pending', pendingCount: 1 })
      expect(result.failures).toEqual([
        { sourceEventId: 'quarantine:one', cause: 'http-4xx', httpStatus: 400, attempts: attempt },
      ])
    }
    expect(readFeedbackFailures(path)).toHaveLength(1)
    const last = await flush(path, dependencies)
    expect(last).toEqual({
      status: 'empty',
      pendingCount: 0,
      deliveredCount: 0,
      rejected: [
        {
          sourceEventId: 'quarantine:one',
          diagnostic: 'delivery-quarantined',
          cause: 'http-4xx',
          httpStatus: 400,
          attempts: 5,
        },
      ],
    })
    expect(readFeedbackFailures(path)).toEqual([])
    expect(readRejectedDetails(path)).toMatchObject([
      {
        record: { envelope: { sourceEventId: 'quarantine:one' } },
        rejection: { diagnostic: 'delivery-quarantined', cause: 'http-4xx', attempts: 5 },
      },
    ])
  })

  it('restarts the count when the cause changes and never quarantines transient causes', async () => {
    const path = await retain('quarantine:two')
    await flush(path, failing(http(400)))
    await flush(path, failing(http(400)))
    expect((await flush(path, failing(http(404)))).failures?.[0]?.attempts).toBe(3)
    expect((await flush(path, failing(http(503)))).failures?.[0]?.attempts).toBe(1)
    for (let attempt = 0; attempt < QUARANTINE_ATTEMPTS + 1; attempt++)
      await flush(path, failing(http(503)))
    for (let attempt = 0; attempt < QUARANTINE_ATTEMPTS + 2; attempt++)
      await flush(path, failing(http(503)), {})
    expect(readFeedbackFailures(path)).toEqual([
      { sourceEventId: 'quarantine:two', cause: 'missing-env:AGENT_BLACKBOARD_URL', attempts: 7 },
    ])
    expect(readRejectedDetails(path)).toEqual([])
  })

  it('tries the records behind a record-specific failure but stops at an outage', async () => {
    const path = await retain('order:one', 'order:two')
    expect((await flush(path, failing(http(400)))).failures).toHaveLength(2)
    expect((await flush(path, failing(http(503)))).failures).toHaveLength(1)
  })
})

describe('pruning', () => {
  it('stores the rejection and deletes only rejections old enough', async () => {
    const path = await retain('prune:one', 'prune:two')
    const record = {
      identity,
      envelope: envelope('prune:one'),
    }
    rejectFeedbackOutbox(path, record, { diagnostic: 'event-conflict', cause: 'http-4xx' })
    expect(pruneRejectedFeedbackOutbox(path, 7)).toBe(0)
    expect(readRejectedDetails(path)[0]?.rejection).toEqual({
      diagnostic: 'event-conflict',
      cause: 'http-4xx',
    })
    const stale = new Date(Date.now() - 8 * 86_400_000)
    for (const name of readdirSync(path))
      if (name.endsWith('.rejected')) utimesSync(join(path, name), stale, stale)
    expect(pruneRejectedFeedbackOutbox(path, 7)).toBe(1)
    expect(readRejectedDetails(path)).toEqual([])
    expect(pruneRejectedFeedbackOutbox(join(path, 'missing'), 0)).toBe(0)
    expect(readFeedbackFailures(path)).toEqual([])
  })
})
