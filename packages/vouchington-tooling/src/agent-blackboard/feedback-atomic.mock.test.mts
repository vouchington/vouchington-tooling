import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const failures = vi.hoisted(() => ({ rename: false, directorySync: false }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: (from: import('node:fs').PathLike, to: import('node:fs').PathLike) => {
      if (failures.rename) throw new Error('controlled rename failure')
      return actual.renameSync(from, to)
    },
    fsyncSync: (descriptor: number) => {
      if (failures.directorySync && actual.fstatSync(descriptor).isDirectory())
        throw new Error('controlled directory fsync failure')
      return actual.fsyncSync(descriptor)
    },
  }
})
import { createFeedbackEnvelope, feedbackOutboxStatus, writeFeedback } from './index.mts'
const directories: string[] = []
afterEach(async () => {
  failures.rename = false
  failures.directorySync = false
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
