import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  createFeedbackEnvelope,
  feedbackOutboxCounts,
  flushFeedbackOutbox,
  writeFeedback,
  type BlackboardClientModule,
} from './index.mts'
import { persistFeedbackOutbox } from './feedback-outbox.mts'
import { readRejectedFeedbackOutbox, rejectFeedbackOutbox } from './feedback-outbox-rejected.mts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const env = { AGENT_BLACKBOARD_URL: 'https://provider.test', AGENT_BLACKBOARD_TOKEN: 'test-token' }
const timestamp = '2026-01-01T00:00:00.000Z'
const identity = { sessionId: 'native:owner', parentSessionId: null, agent: 'claude', version: '2' }
const wrongVersion = { ...identity, version: 'unknown' }
const envelope = (sourceEventId = 'rejected:one') =>
  createFeedbackEnvelope({
    schemaVersion: 1,
    type: 'journal',
    sourceEventId,
    timestamp,
    repositories: ['owner/repo'],
    markdown: 'A useful finding',
    workOutcome: 'unknown',
    feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
  })
/** Rejects session identities that differ from the stored one with a 409, like the provider. */
function provider(stored: { version: string }) {
  const entries: unknown[] = []
  return {
    loadClient: async (): Promise<BlackboardClientModule> => ({
      Sessions: class {
        async ensure(input: { version: string }) {
          if (input.version !== stored.version)
            throw Object.assign(new Error('conflict'), { status: 409 })
          return {
            status: 'exists' as const,
            session: { data: { repositories: ['owner/repo'] }, archivedAt: null },
          }
        }
        async patch() {}
        async list() {}
        async get() {}
      },
      Entries: class {
        async append(input: { data: unknown }) {
          entries.push({ createdAt: timestamp, data: input.data })
          return { createdAt: timestamp, data: input.data }
        }
        async *get() {
          yield* entries
        }
      },
    }),
  }
}
async function outbox(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'feedback-rejected-'))
  directories.push(path)
  return path
}

it('moves an identity-conflict append out of pending so a corrected retry is delivered', async () => {
  const path = await outbox()
  const dependencies = provider({ version: '2' })
  const write = (who: typeof identity) =>
    writeFeedback({
      identity: who,
      envelope: envelope(),
      mode: 'interactive',
      outboxDirectory: path,
      env,
      dependencies,
    })
  await expect(write(wrongVersion)).rejects.toMatchObject({ diagnostic: 'identity-conflict' })
  expect(feedbackOutboxCounts(path, identity.sessionId)).toEqual({
    pendingCount: 0,
    worktreePendingCount: 0,
    rejectedCount: 1,
    worktreeRejectedCount: 1,
  })
  await expect(write(identity)).resolves.toMatchObject({ status: 'delivered', pendingCount: 0 })
  expect(feedbackOutboxCounts(path, 'native:other')).toMatchObject({
    rejectedCount: 0,
    worktreeRejectedCount: 1,
  })
})

it('moves a retained record that now gets identity-conflict during flush and reports it', async () => {
  const path = await outbox()
  await writeFeedback({
    identity: wrongVersion,
    envelope: envelope(),
    mode: 'interactive',
    outboxDirectory: path,
    env: {},
  })
  expect(feedbackOutboxCounts(path, identity.sessionId).pendingCount).toBe(1)
  await expect(
    flushFeedbackOutbox({ directory: path, env, dependencies: provider({ version: '2' }) }),
  ).resolves.toEqual({
    status: 'empty',
    pendingCount: 0,
    deliveredCount: 0,
    rejected: [{ sourceEventId: 'rejected:one', diagnostic: 'identity-conflict' }],
  })
  expect(feedbackOutboxCounts(path, identity.sessionId)).toMatchObject({
    pendingCount: 0,
    rejectedCount: 1,
  })
  expect(readRejectedFeedbackOutbox(path)).toHaveLength(1)
})

it('keeps transient failures pending and ignores records that are no longer pending', async () => {
  const path = await outbox()
  await writeFeedback({
    identity,
    envelope: envelope(),
    mode: 'interactive',
    outboxDirectory: path,
    env: {},
  })
  await expect(flushFeedbackOutbox({ directory: path, env: {} })).resolves.toMatchObject({
    status: 'pending',
    pendingCount: 1,
    diagnostic: 'configuration-invalid',
  })
  rejectFeedbackOutbox(path, { identity, envelope: envelope('absent') })
  expect(feedbackOutboxCounts(path, identity.sessionId).rejectedCount).toBe(0)
  expect(() =>
    rejectFeedbackOutbox(path, {
      identity,
      envelope: { ...envelope(), markdown: 'changed meanwhile' },
    }),
  ).toThrow(/changed during delivery/)
  expect(readRejectedFeedbackOutbox(join(path, 'missing'))).toEqual([])
  persistFeedbackOutbox(path, { identity, envelope: envelope('two') })
  expect(feedbackOutboxCounts(path, identity.sessionId).pendingCount).toBe(2)
})
