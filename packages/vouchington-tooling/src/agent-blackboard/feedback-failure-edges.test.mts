import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FeedbackDeliveryError, feedbackFailure } from './feedback-online-error.mts'
import { recordFeedbackFailure } from './feedback-outbox-failure.mts'
import { readRecord } from './feedback-outbox-read.mts'
import { readRejectedDetails, rejectFeedbackOutbox } from './feedback-outbox-rejected.mts'
import { createFeedbackEnvelope, writeFeedback } from './index.mts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const identity = { sessionId: 'native:owner', parentSessionId: null, agent: 'claude', version: '2' }
const record = (sourceEventId: string, markdown = 'A useful finding') => ({
  identity,
  envelope: createFeedbackEnvelope({
    schemaVersion: 1,
    type: 'journal',
    sourceEventId,
    timestamp: '2026-01-01T00:00:00.000Z',
    repositories: ['owner/repo'],
    markdown,
    workOutcome: 'unknown',
    feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
  }),
})
async function outbox(...ids: string[]): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'feedback-edges-'))
  directories.push(path)
  for (const id of ids)
    await writeFeedback({ ...record(id), mode: 'interactive', outboxDirectory: path, env: {} })
  return path
}
const only = (path: string, suffix: string) =>
  join(
    path,
    readdirSync(path).find((name) => name.endsWith(suffix))!,
  )

describe('failure edges', () => {
  it('keeps a delivery error cause and classifies any other error', () => {
    const cause = { cause: 'http-4xx', httpStatus: 400 }
    expect(
      feedbackFailure(new FeedbackDeliveryError('blackboard-unavailable', undefined, cause)),
    ).toBe(cause)
    expect(feedbackFailure(new FeedbackDeliveryError('event-conflict'))).toEqual({
      cause: 'event-conflict',
    })
    expect(feedbackFailure(Object.assign(new Error('x'), { status: 503 }))).toEqual({
      cause: 'http-5xx',
      httpStatus: 503,
    })
  })

  it('ignores a record that left the outbox and refuses one that changed', async () => {
    const path = await outbox('edge:one')
    expect(recordFeedbackFailure(path, record('edge:gone'), { cause: 'http-4xx' })).toEqual({
      failure: { cause: 'http-4xx', attempts: 1 },
      quarantined: false,
    })
    expect(() =>
      recordFeedbackFailure(path, record('edge:one', 'A changed finding'), { cause: 'http-4xx' }),
    ).toThrow('feedback outbox changed during delivery')
  })

  it('rejects an oversized record file and reads a rejection without a stored note', async () => {
    const path = await outbox('edge:big', 'edge:legacy')
    const big = only(path, '.json')
    writeFileSync(big, ' '.repeat(20_000))
    expect(() => readRecord(big)).toThrow('feedback outbox record is too large')
    const legacy = await outbox('edge:legacy')
    rejectFeedbackOutbox(legacy, record('edge:legacy'), { diagnostic: 'event-conflict' })
    const file = only(legacy, '.rejected')
    const { rejection: _note, ...rest } = JSON.parse(readFileSync(file, 'utf8')) as Record<
      string,
      unknown
    >
    writeFileSync(file, JSON.stringify(rest))
    expect(readRejectedDetails(legacy)).toEqual([{ record: record('edge:legacy') }])
  })
})
