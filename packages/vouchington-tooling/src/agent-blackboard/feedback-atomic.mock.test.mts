import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const failures = vi.hoisted(() => ({
  rename: false,
  directorySync: false,
  write: false,
  fileSync: false,
  unlink: false,
  cleanupOnce: false,
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    unlinkSync: (path: import('node:fs').PathLike) => {
      if (failures.unlink && String(path).endsWith('.json')) {
        if (failures.cleanupOnce) failures.unlink = false
        throw new Error('controlled unlink failure')
      }
      return actual.unlinkSync(path)
    },
    writeSync: (...args: Parameters<typeof actual.writeSync>) => {
      if (failures.write) throw new Error('controlled file write failure')
      return actual.writeSync(...args)
    },
    renameSync: (from: import('node:fs').PathLike, to: import('node:fs').PathLike) => {
      if (failures.rename) throw new Error('controlled rename failure')
      return actual.renameSync(from, to)
    },
    fsyncSync: (descriptor: number) => {
      if (failures.fileSync && actual.fstatSync(descriptor).isFile())
        throw new Error('controlled file fsync failure')
      if (failures.directorySync && actual.fstatSync(descriptor).isDirectory()) {
        if (failures.cleanupOnce) failures.directorySync = false
        throw new Error('controlled directory fsync failure')
      }
      return actual.fsyncSync(descriptor)
    },
  }
})
import {
  createFeedbackEnvelope,
  feedbackOutboxStatus,
  flushFeedbackOutbox,
  writeFeedback,
} from './index.mts'
const directories: string[] = []
afterEach(async () => {
  failures.rename = false
  failures.directorySync = false
  failures.write = false
  failures.fileSync = false
  failures.unlink = false
  failures.cleanupOnce = false
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const identity = { sessionId: 'native:owner', parentSessionId: null, agent: 'codex', version: '1' }
const envelope = () =>
  createFeedbackEnvelope({
    schemaVersion: 1,
    type: 'journal',
    sourceEventId: 'atomic:source',
    timestamp: '2026-01-01T00:00:00.000Z',
    repositories: ['owner/repo'],
    markdown: 'Atomic durable finding',
    workOutcome: 'unknown',
    feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
  })
it('does not acknowledge failed rename persistence or evict older pending records', async () => {
  const path = await mkdtemp(join(tmpdir(), 'feedback-atomic-'))
  directories.push(path)
  await writeFeedback({
    identity,
    envelope: { ...envelope(), sourceEventId: 'previous:source' },
    mode: 'interactive',
    outboxDirectory: path,
    env: {},
  })
  failures.rename = true
  await expect(
    writeFeedback({
      identity,
      envelope: envelope(),
      mode: 'interactive',
      outboxDirectory: path,
      env: {},
    }),
  ).rejects.toThrow(/rename failure/)
  expect(feedbackOutboxStatus(path).pendingCount).toBe(1)
  expect(await readdir(path)).toHaveLength(1)
})
it('reports directory durability failure while retaining the already-renamed unsent record', async () => {
  const path = await mkdtemp(join(tmpdir(), 'feedback-atomic-'))
  directories.push(path)
  failures.directorySync = true
  await expect(
    writeFeedback({
      identity,
      envelope: envelope(),
      mode: 'interactive',
      outboxDirectory: path,
      env: {},
    }),
  ).rejects.toThrow(/fsync failure/)
  expect(feedbackOutboxStatus(path).pendingCount).toBe(1)
})

it.each(['write', 'fileSync'] as const)(
  'cleans up unacknowledged %s failures without poisoning capture or replay',
  async (kind) => {
    const path = await mkdtemp(join(tmpdir(), 'feedback-failed-write-'))
    directories.push(path)
    await writeFeedback({
      identity,
      envelope: { ...envelope(), sourceEventId: 'previous' },
      mode: 'interactive',
      outboxDirectory: path,
      env: {},
    })
    failures[kind] = true
    await expect(
      writeFeedback({
        identity,
        envelope: envelope(),
        mode: 'interactive',
        outboxDirectory: path,
        env: {},
      }),
    ).rejects.toThrow(/controlled file/)
    failures[kind] = false
    expect(await readdir(path)).toHaveLength(1)
    expect(feedbackOutboxStatus(path).pendingCount).toBe(1)
    await expect(
      writeFeedback({
        identity,
        envelope: envelope(),
        mode: 'interactive',
        outboxDirectory: path,
        env: {},
      }),
    ).resolves.toMatchObject({ status: 'pending', pendingCount: 2 })
  },
)

function cleanupProvider(failure: 'directorySync' | 'unlink') {
  const stored: Array<{ createdAt: string; data: unknown }> = []
  let injected = false
  return {
    loadClient: async () => ({
      Sessions: class {
        async ensure() {
          return { status: 'exists' as const, session: { data: { repositories: ['owner/repo'] } } }
        }
        async patch() {}
        async list() {}
        async get() {}
      },
      Entries: class {
        async append(input: unknown) {
          const entry = {
            createdAt: '2026-01-01T00:00:01.000Z',
            data: (input as { data: unknown }).data,
          }
          stored.push(entry)
          if (!injected) {
            failures[failure] = true
            failures.cleanupOnce = true
            injected = true
          }
          return entry
        }
        async *get() {
          yield* stored
        }
      },
    }),
  }
}
it.each(['directorySync', 'unlink'] as const)(
  'preserves verified receipts after cleanup %s failure',
  async (failure) => {
    const path = await mkdtemp(join(tmpdir(), 'feedback-cleanup-'))
    directories.push(path)
    const result = await writeFeedback({
      identity,
      envelope: envelope(),
      mode: 'interactive',
      outboxDirectory: path,
      env: {
        AGENT_BLACKBOARD_URL: 'https://provider.test',
        AGENT_BLACKBOARD_TOKEN: 'test-private-token',
      },
      dependencies: cleanupProvider(failure),
    })
    const pendingCount = failure === 'unlink' ? 1 : 0
    expect(result).toMatchObject({
      status: 'delivered',
      pendingCount,
      cleanupDiagnostic: 'outbox-cleanup-failed',
      receipt: { verified: true, createdAt: '2026-01-01T00:00:01.000Z' },
    })
    expect(feedbackOutboxStatus(path).pendingCount).toBe(pendingCount)
  },
)
it.each(['directorySync', 'unlink'] as const)(
  'counts verified flush delivery after cleanup %s failure',
  async (failure) => {
    const path = await mkdtemp(join(tmpdir(), 'feedback-flush-cleanup-'))
    directories.push(path)
    await writeFeedback({
      identity,
      envelope: envelope(),
      mode: 'interactive',
      outboxDirectory: path,
      env: {},
    })
    await writeFeedback({
      identity,
      envelope: { ...envelope(), sourceEventId: 'second:cleanup' },
      mode: 'interactive',
      outboxDirectory: path,
      env: {},
    })
    const result = await flushFeedbackOutbox({
      directory: path,
      env: {
        AGENT_BLACKBOARD_URL: 'https://provider.test',
        AGENT_BLACKBOARD_TOKEN: 'test-private-token',
      },
      dependencies: cleanupProvider(failure),
    })
    expect(result).toEqual({
      status: failure === 'unlink' ? 'pending' : 'empty',
      pendingCount: failure === 'unlink' ? 1 : 0,
      deliveredCount: 2,
      cleanupDiagnostic: 'outbox-cleanup-failed',
    })
  },
)
