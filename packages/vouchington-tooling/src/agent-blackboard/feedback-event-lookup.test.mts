import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BlackboardClientDependencies, BlackboardClientModule } from './client.mts'
import {
  createFeedbackEnvelope,
  findFeedbackEventTimestamp,
  type FeedbackEventLookup,
} from './index.mts'
import { persistFeedbackOutbox } from './feedback-outbox.mts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function outbox(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'feedback-lookup-'))
  directories.push(path)
  return path
}

const ENV = { AGENT_BLACKBOARD_URL: 'https://provider.test', AGENT_BLACKBOARD_TOKEN: 'test-token' }
const SESSION = 'native:owner'
const EVENT = 'journal:1'
const RECORDED = '2026-01-01T00:00:00.000Z'
const identity = { sessionId: SESSION, parentSessionId: null, agent: 'codex', version: '1' }
const envelope = (sourceEventId: string, timestamp: string) =>
  createFeedbackEnvelope({
    schemaVersion: 1,
    type: 'journal',
    sourceEventId,
    timestamp,
    repositories: ['owner/repo'],
    markdown: 'A retained note',
    workOutcome: 'unknown',
    feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
  })

type Remote = { gets: unknown[]; dependencies: BlackboardClientDependencies }
/** A client whose `Entries.get` yields what the test hands it. */
function remote(entries: () => AsyncIterable<unknown>): Remote {
  const gets: unknown[] = []
  class Entries {
    get(input: unknown) {
      gets.push(input)
      return entries()
    }
  }
  const module = { Sessions: class {}, Entries } as unknown as BlackboardClientModule
  return { gets, dependencies: { loadClient: async () => module } }
}
const listing = (...entries: unknown[]) =>
  remote(async function* () {
    yield* entries
  })
const entryAt = (sourceEventId: string, timestamp: unknown) => ({
  createdAt: '2026-01-01T00:00:09.000Z',
  data: { sourceEventId, timestamp },
})
const lookup = (input: Partial<FeedbackEventLookup> = {}) =>
  findFeedbackEventTimestamp({ sessionId: SESSION, sourceEventId: EVENT, env: ENV, ...input })
const unreachable: BlackboardClientDependencies = {
  loadClient: async () => {
    throw new Error('the remote session must not be consulted')
  },
}

describe('findFeedbackEventTimestamp from the durable outbox', () => {
  it('reuses the timestamp of a retained record without asking the remote session', async () => {
    const path = await outbox()
    persistFeedbackOutbox(path, { identity, envelope: envelope(EVENT, RECORDED) })
    expect(await lookup({ outboxDirectory: path, env: {}, dependencies: unreachable })).toBe(
      RECORDED,
    )
  })

  it('ignores records of another session or event and falls through to the remote session', async () => {
    const path = await outbox()
    const stranger = { ...identity, sessionId: 'native:other' }
    persistFeedbackOutbox(path, { identity: stranger, envelope: envelope(EVENT, RECORDED) })
    persistFeedbackOutbox(path, { identity, envelope: envelope('journal:2', RECORDED) })
    const none = listing()
    expect(await lookup({ outboxDirectory: path, dependencies: none.dependencies })).toBeUndefined()
    expect(none.gets).toHaveLength(1)
  })

  it('does not create the outbox directory and falls through when it is absent', async () => {
    const path = join(await outbox(), 'not-created')
    const found = listing(entryAt(EVENT, RECORDED))
    expect(await lookup({ outboxDirectory: path, dependencies: found.dependencies })).toBe(RECORDED)
    await expect(readdir(path)).rejects.toThrow(/ENOENT/)
  })

  it('falls through to the remote session when the outbox cannot be read', async () => {
    const unsafe = await outbox()
    await chmod(unsafe, 0o755)
    const found = listing(entryAt(EVENT, RECORDED))
    expect(await lookup({ outboxDirectory: unsafe, dependencies: found.dependencies })).toBe(
      RECORDED,
    )
    const corrupt = await outbox()
    persistFeedbackOutbox(corrupt, { identity, envelope: envelope(EVENT, RECORDED) })
    await writeFile(join(corrupt, (await readdir(corrupt))[0]!), 'malformed')
    expect(await lookup({ outboxDirectory: corrupt, dependencies: found.dependencies })).toBe(
      RECORDED,
    )
  })
})

describe('findFeedbackEventTimestamp from the remote session', () => {
  it('reads the named session and returns the first canonical timestamp for the event', async () => {
    const entries = listing(
      null,
      'not an entry',
      { createdAt: 'x', data: 'not an object' },
      entryAt('journal:2', '2026-02-02T00:00:00.000Z'),
      entryAt(EVENT, '2026-01-01T00:00:00Z'),
      entryAt(EVENT, 17),
      entryAt(EVENT, RECORDED),
      entryAt(EVENT, '2026-03-03T00:00:00.000Z'),
    )
    expect(await lookup({ dependencies: entries.dependencies })).toBe(RECORDED)
    expect(entries.gets).toEqual([{ sessionId: SESSION, format: 'jsonl' }])
  })

  it('reports nothing for a new event', async () => {
    expect(await lookup({ dependencies: listing().dependencies })).toBeUndefined()
    expect(
      await lookup({ dependencies: listing(entryAt('journal:2', RECORDED)).dependencies }),
    ).toBeUndefined()
  })

  it('reports nothing instead of failing when the lookup cannot finish', async () => {
    expect(await lookup({ env: {}, dependencies: unreachable })).toBeUndefined()
    // The token is never sent over plain http to a non-loopback host, so the client is not loaded.
    const insecure = { ...ENV, AGENT_BLACKBOARD_URL: 'http://provider.test' }
    expect(await lookup({ env: insecure, dependencies: unreachable })).toBeUndefined()
    expect(await lookup({ dependencies: unreachable })).toBeUndefined()
    const failing = remote(async function* () {
      yield* []
      throw new Error('backend exploded')
    })
    expect(await lookup({ dependencies: failing.dependencies })).toBeUndefined()
    const hanging = remote(async function* () {
      await new Promise<never>(() => {})
      yield* []
    })
    expect(await lookup({ dependencies: hanging.dependencies, timeoutMs: 5 })).toBeUndefined()
  })

  it('refuses to scan an unbounded history', async () => {
    const many = remote(async function* () {
      for (let index = 0; index < 10_001; index++) yield entryAt(`other:${index}`, RECORDED)
      yield entryAt(EVENT, RECORDED)
    })
    expect(await lookup({ dependencies: many.dependencies })).toBeUndefined()
    const large = listing({ data: { markdown: 'x'.repeat(2_000_001) } }, entryAt(EVENT, RECORDED))
    expect(await lookup({ dependencies: large.dependencies })).toBeUndefined()
  })
})
