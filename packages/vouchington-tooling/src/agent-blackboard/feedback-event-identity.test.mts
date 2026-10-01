import { expect, it } from 'vitest'
import {
  createFeedbackEnvelope,
  verifyFreshFeedback,
  writeFeedback,
  type BlackboardClientModule,
  type FeedbackEnvelope,
} from './index.mts'

const identity = { sessionId: 'native:owner', parentSessionId: null, agent: 'codex', version: '1' }
const env = {
  AGENT_BLACKBOARD_URL: 'https://provider.test',
  AGENT_BLACKBOARD_TOKEN: 'private-test-token',
}
const EARLIER = '2026-01-01T00:00:00.000Z'
const LATER = '2026-01-01T00:10:00.000Z'

function envelope(timestamp: string, markdown = 'A useful finding'): FeedbackEnvelope {
  return createFeedbackEnvelope({
    schemaVersion: 1,
    type: 'journal',
    sourceEventId: 'identity:source',
    timestamp,
    repositories: ['owner/repo'],
    markdown,
    workOutcome: 'unknown',
    feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
  })
}

type Stored = { createdAt: string; data: unknown }

/** A provider whose `lateEntry` is written by someone else just before the next append. */
function provider(options: { entries?: Stored[]; lateEntry?: Stored } = {}) {
  const stored = options.entries ?? []
  let lateEntry = options.lateEntry
  let appends = 0
  return {
    stored,
    appends: () => appends,
    dependencies: {
      loadClient: async (): Promise<BlackboardClientModule> => ({
        Sessions: class {
          async ensure() {
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
          async append(input: unknown) {
            appends++
            if (lateEntry) stored.push(lateEntry)
            lateEntry = undefined
            const entry = {
              createdAt: `2026-01-02T00:00:0${stored.length}.000Z`,
              data: (input as { data: unknown }).data,
            }
            stored.push(entry)
            return entry
          }
          async *get() {
            yield* stored
          }
        },
      }),
    },
  }
}

const options = (service: ReturnType<typeof provider>) => ({
  identity,
  env,
  dependencies: service.dependencies,
})

it('returns the stored record when a retry differs from it only in timestamp', async () => {
  const service = provider({
    entries: [{ createdAt: '2026-01-01T00:00:01.000Z', data: envelope(EARLIER) }],
  })
  const result = await writeFeedback({
    ...options(service),
    envelope: envelope(LATER),
    mode: 'autonomous',
  })
  expect(result).toMatchObject({
    status: 'delivered',
    receipt: { createdAt: '2026-01-01T00:00:01.000Z', timestamp: EARLIER, verified: true },
  })
  expect(service.appends()).toBe(0)
})

it('reports the earliest stored record when a late write duplicates the event', async () => {
  const service = provider({
    lateEntry: { createdAt: '2026-01-01T00:00:01.000Z', data: envelope(EARLIER) },
  })
  const result = await writeFeedback({
    ...options(service),
    envelope: envelope(LATER),
    mode: 'autonomous',
  })
  expect(result).toMatchObject({
    status: 'delivered',
    receipt: { createdAt: '2026-01-01T00:00:01.000Z', timestamp: EARLIER },
  })
  expect(service.stored).toHaveLength(2)
})

it('still rejects different content with the same source event id, whatever the timestamp', async () => {
  const service = provider({
    entries: [{ createdAt: '2026-01-01T00:00:01.000Z', data: envelope(EARLIER, 'Other finding') }],
  })
  for (const timestamp of [EARLIER, LATER])
    await expect(
      writeFeedback({ ...options(service), envelope: envelope(timestamp), mode: 'autonomous' }),
    ).rejects.toMatchObject({ diagnostic: 'event-conflict' })
  expect(service.appends()).toBe(0)
})

it('keeps admission fresh: any earlier record of the event, even another timestamp, conflicts', async () => {
  const service = provider({
    entries: [{ createdAt: '2026-01-01T00:00:01.000Z', data: envelope(EARLIER) }],
  })
  await expect(
    verifyFreshFeedback({ ...options(service), envelope: envelope(LATER) }),
  ).rejects.toMatchObject({ diagnostic: 'event-conflict' })
  expect(service.appends()).toBe(0)
})

it('keeps admission fresh: a write that lands beside the probe is not proof of a fresh one', async () => {
  const service = provider({
    lateEntry: { createdAt: '2026-01-01T00:00:01.000Z', data: envelope(EARLIER) },
  })
  await expect(
    verifyFreshFeedback({ ...options(service), envelope: envelope(LATER) }),
  ).rejects.toMatchObject({ diagnostic: 'event-conflict' })
})

it('verifies a fresh admission whose event nobody else has written', async () => {
  const service = provider()
  await expect(
    verifyFreshFeedback({ ...options(service), envelope: envelope(LATER) }),
  ).resolves.toMatchObject({
    status: 'delivered',
    receipt: { timestamp: LATER, verified: true },
  })
})
