import { feedbackDeadline } from './feedback-deadline.mts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  autonomousGate,
  feedbackOutboxStatus,
  createFeedbackEnvelope,
  flushFeedbackOutbox,
  writeFeedback,
  type BlackboardClientModule,
  type FeedbackEnvelope,
} from './index.mts'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const identity = { sessionId: 'native:owner', parentSessionId: null, agent: 'codex', version: '1' }
const env = {
  AGENT_BLACKBOARD_URL: 'https://provider.test',
  AGENT_BLACKBOARD_TOKEN: 'private-test-token',
}
const timestamp = '2026-01-01T00:00:00.000Z'
const envelope = (): FeedbackEnvelope =>
  createFeedbackEnvelope({
    schemaVersion: 1,
    type: 'journal',
    sourceEventId: 'boundary:source',
    timestamp,
    repositories: ['owner/repo'],
    markdown: 'A useful finding',
    workOutcome: 'unknown',
    feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
  })
function provider(
  options: {
    error?: unknown
    archived?: boolean
    before?: unknown[]
    after?: unknown[]
    existing?: unknown
  } = {},
) {
  const stored: unknown[] = []
  return {
    loadClient: async (): Promise<BlackboardClientModule> => ({
      Sessions: class {
        async ensure() {
          if (options.error) throw options.error
          return {
            status: 'exists' as const,
            session: {
              data: { repositories: ['owner/repo'] },
              archivedAt: options.archived ? timestamp : null,
            },
          }
        }
        async patch() {}
        async list() {}
        async get() {
          return options.existing
        }
      },
      Entries: class {
        async append(input: unknown) {
          stored.push({ createdAt: timestamp, data: (input as { data: unknown }).data })
          return { createdAt: timestamp }
        }
        async *get() {
          yield* stored.length ? (options.after ?? stored) : (options.before ?? [])
        }
      },
    }),
  }
}
it('distinguishes invalid configuration and unavailable client dependencies from network outages', async () => {
  for (const invalid of [
    {},
    { AGENT_BLACKBOARD_URL: 'invalid', AGENT_BLACKBOARD_TOKEN: 'private' },
    { AGENT_BLACKBOARD_URL: 'http://remote.test', AGENT_BLACKBOARD_TOKEN: 'private' },
    {
      AGENT_BLACKBOARD_URL: 'https://user:secret@provider.test',
      AGENT_BLACKBOARD_TOKEN: 'private',
    },
    { AGENT_BLACKBOARD_URL: 'https://provider.test' },
  ])
    await expect(
      autonomousGate({ identity, envelope: envelope(), env: invalid }),
    ).rejects.toMatchObject({ diagnostic: 'configuration-invalid' })
  await expect(
    autonomousGate({
      identity,
      envelope: envelope(),
      env,
      dependencies: {
        loadClient: async () => {
          throw Object.assign(new Error('not installed'), { code: 'MODULE_NOT_FOUND' })
        },
      },
    }),
  ).rejects.toMatchObject({ diagnostic: 'client-unavailable' })
  await expect(
    autonomousGate({
      identity,
      envelope: envelope(),
      env,
      dependencies: provider({ error: Object.assign(new Error('transport'), { status: 409 }) }),
    }),
  ).rejects.toMatchObject({ diagnostic: 'identity-conflict' })
  await expect(
    autonomousGate({
      identity,
      envelope: envelope(),
      env,
      dependencies: provider({ archived: true }),
    }),
  ).rejects.toMatchObject({ diagnostic: 'archived-session' })
})
it('blocks hostile matching records and bounded incomplete readback without authorizing admission', async () => {
  for (const before of [
    [null, 1, {}],
    [{ createdAt: timestamp, data: { ...envelope(), type: 'unsupported' } }],
    Array(10001).fill(null),
    [{ raw: 'x'.repeat(2_000_001) }],
  ]) {
    const dependencies = provider({ before })
    if (before.length === 3)
      await expect(
        autonomousGate({ identity, envelope: envelope(), env, dependencies }),
      ).resolves.toMatchObject({ status: 'delivered' })
    else
      await expect(
        autonomousGate({ identity, envelope: envelope(), env, dependencies }),
      ).rejects.toMatchObject({
        diagnostic:
          before.length === 1 && (before[0] as { data?: unknown }).data
            ? 'event-conflict'
            : 'readback-unconfirmed',
      })
  }
  await expect(
    autonomousGate({ identity, envelope: envelope(), env, dependencies: provider({ after: [] }) }),
  ).rejects.toMatchObject({ diagnostic: 'readback-unconfirmed' })
})
it('rejects invalid explicit identity, timeout and mode boundaries before launching work', async () => {
  for (const badIdentity of [
    null,
    { ...identity, sessionId: 'a'.repeat(257) },
    { ...identity, parentSessionId: 42 },
  ])
    await expect(
      writeFeedback({
        identity: badIdentity as typeof identity,
        envelope: envelope(),
        mode: 'autonomous',
        env,
      }),
    ).rejects.toThrow(/identity|long/)
  await expect(
    writeFeedback({
      identity,
      envelope: envelope(),
      mode: 'autonomous',
      outboxDirectory: '/private/tmp/disallowed',
      env,
    }),
  ).rejects.toThrow(/cannot use/)
  await expect(
    writeFeedback({ identity, envelope: envelope(), mode: 'interactive', env }),
  ).rejects.toThrow(/requires/)
  await expect(
    autonomousGate({ identity, envelope: envelope(), env, timeoutMs: 0 }),
  ).rejects.toThrow(/timeoutMs/)
  await expect(
    writeFeedback({
      identity,
      envelope: { ...envelope(), sourceEventId: 'private-test-token' },
      mode: 'autonomous',
      env,
    }),
  ).rejects.toThrow(/sensitive value/)
})
it('exposes failed outbox replay and removes a delivered interactive record only after verification', async () => {
  const path = await mkdtemp(join(tmpdir(), 'feedback-replay-boundary-'))
  directories.push(path)
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
    deliveredCount: 0,
    diagnostic: 'configuration-invalid',
  })
  const result = await writeFeedback({
    identity,
    envelope: envelope(),
    mode: 'interactive',
    outboxDirectory: path,
    env,
    dependencies: provider(),
  })
  expect(result).toMatchObject({ status: 'delivered', pendingCount: 0 })
})
it('retains unsent records but hard-fails permanent event and archive conflicts', async () => {
  for (const options of [
    { archived: true },
    {
      before: [{ createdAt: timestamp, data: { ...envelope(), markdown: 'conflicting finding' } }],
    },
  ]) {
    const path = await mkdtemp(join(tmpdir(), 'feedback-permanent-conflict-'))
    directories.push(path)
    await expect(
      writeFeedback({
        identity,
        envelope: envelope(),
        mode: 'interactive',
        outboxDirectory: path,
        env,
        dependencies: provider(options),
      }),
    ).rejects.toMatchObject({
      diagnostic: options.archived ? 'archived-session' : 'event-conflict',
    })
    expect(feedbackOutboxStatus(path)).toEqual({ status: 'pending', pendingCount: 1 })
  }
})
it('keeps ensure failures classified as outages when fetched metadata does not establish a conflict', async () => {
  for (const existing of [
    { id: identity.sessionId, ...identity },
    { id: 'another-session', agent: 'claude' },
  ])
    await expect(
      autonomousGate({
        identity,
        envelope: envelope(),
        env,
        dependencies: provider({ error: new Error('private outage'), existing }),
      }),
    ).rejects.toMatchObject({ diagnostic: 'blackboard-unavailable' })
})

it('propagates a synchronous operation failure before allocating its deadline timer', async () => {
  const failure = new Error('operation could not start')
  await expect(
    feedbackDeadline(() => {
      throw failure
    }),
  ).rejects.toBe(failure)
})
