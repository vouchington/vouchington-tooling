import { expect, it } from 'vitest'
import {
  verifyFreshFeedback,
  createFeedbackEnvelope,
  type BlackboardClientModule,
} from './index.mts'
const identity = { sessionId: 'owner', parentSessionId: null, agent: 'codex', version: '1' }
const env = {
  AGENT_BLACKBOARD_URL: 'https://provider.test',
  AGENT_BLACKBOARD_TOKEN: 'test-private-token',
}
const envelope = createFeedbackEnvelope({
  schemaVersion: 1,
  type: 'journal',
  sourceEventId: 'authorization:probe',
  timestamp: '2026-01-01T00:00:00.000Z',
  repositories: ['owner/repo'],
  markdown: 'Fresh online reporting proof',
  workOutcome: 'in-progress',
  feedbackCoverage: { status: 'not-started', sources: [], droppedCount: 0 },
})
function barrier() {
  let arrivals = 0
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  return async () => {
    if (++arrivals === 2) release()
    await ready
  }
}
function concurrentProvider(eventual: boolean) {
  const preReads = barrier()
  const appends = barrier()
  const stored: Array<{ createdAt: string; data: unknown }> = []
  let instances = 0
  return {
    loadClient: async (): Promise<BlackboardClientModule> => ({
      Sessions: class {
        async ensure() {
          return { status: 'exists' as const, session: { data: { repositories: ['owner/repo'] } } }
        }
        async patch() {}
        async list() {}
        async get() {}
      },
      Entries: class {
        index = instances++
        reads = 0
        async append(input: unknown) {
          const entry = {
            createdAt: `2026-01-01T00:00:0${this.index + 1}.000Z`,
            data: (input as { data: unknown }).data,
          }
          stored.push(entry)
          await appends()
          return entry
        }
        async *get() {
          if (++this.reads === 1) {
            await preReads()
            return
          }
          yield* eventual
            ? stored.filter(
                (entry) => entry.createdAt === `2026-01-01T00:00:0${this.index + 1}.000Z`,
              )
            : stored
        }
      },
    }),
  }
}
it('rejects visible concurrent same-source duplicates during fresh readback', async () => {
  const dependencies = concurrentProvider(false)
  const results = await Promise.allSettled(
    [0, 1].map(() => verifyFreshFeedback({ identity, envelope, env, dependencies })),
  )
  expect(results).toEqual([
    expect.objectContaining({
      status: 'rejected',
      reason: expect.objectContaining({ diagnostic: 'event-conflict' }),
    }),
    expect.objectContaining({
      status: 'rejected',
      reason: expect.objectContaining({ diagnostic: 'event-conflict' }),
    }),
  ])
})
it('verifies each own receipt under eventual views without implying a distributed execution lease', async () => {
  const dependencies = concurrentProvider(true)
  const results = await Promise.all(
    [0, 1].map(() => verifyFreshFeedback({ identity, envelope, env, dependencies })),
  )
  expect(results.map((result) => result.receipt.createdAt).sort()).toEqual([
    '2026-01-01T00:00:01.000Z',
    '2026-01-01T00:00:02.000Z',
  ])
  expect(results.every((result) => result.receipt.verified)).toBe(true)
})
it('requires the fresh append body and its own creation timestamp in readback', async () => {
  for (const kind of [
    'nonobject',
    'missing-body',
    'wrong-body',
    'missing-time',
    'different-readback-time',
  ]) {
    const createdAt = '2026-01-01T00:00:01.000Z'
    let appended = false
    const dependencies = {
      loadClient: async (): Promise<BlackboardClientModule> => ({
        Sessions: class {
          async ensure() {
            return {
              status: 'exists' as const,
              session: { data: { repositories: ['owner/repo'] } },
            }
          }
          async patch() {}
          async list() {}
          async get() {}
        },
        Entries: class {
          async append() {
            appended = true
            if (kind === 'nonobject') return null as never
            const response = {
              createdAt: kind === 'missing-time' ? (undefined as never) : createdAt,
              ...(kind === 'missing-body'
                ? {}
                : {
                    data: kind === 'wrong-body' ? { ...envelope, markdown: 'different' } : envelope,
                  }),
            }
            return response as { createdAt: string; data: unknown }
          }
          async *get() {
            if (appended)
              yield {
                createdAt:
                  kind === 'different-readback-time' ? '2026-01-01T00:00:02.000Z' : createdAt,
                data: envelope,
              }
          }
        },
      }),
    }
    await expect(
      verifyFreshFeedback({ identity, envelope, env, dependencies }),
    ).rejects.toMatchObject({
      diagnostic: 'readback-unconfirmed',
    })
  }
})
