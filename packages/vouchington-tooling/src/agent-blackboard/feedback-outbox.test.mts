import { chmod, rename, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  persistFeedbackOutbox,
  readFeedbackOutbox,
  removeFeedbackOutbox,
} from './feedback-outbox.mts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createFeedbackEnvelope, feedbackOutboxStatus, writeFeedback } from './index.mts'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'feedback-boundary-'))
  directories.push(path)
  return path
}
const identity = { sessionId: 'native:owner', parentSessionId: null, agent: 'codex', version: '1' }
const envelope = (sourceEventId: string) =>
  createFeedbackEnvelope({
    schemaVersion: 1,
    type: 'journal',
    sourceEventId,
    timestamp: '2026-01-01T00:00:00.000Z',
    repositories: ['owner/repo'],
    markdown: 'Unsent useful finding',
    workOutcome: 'unknown',
    feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
  })
it('preserves all 128 unsent records when the bounded outbox saturates', async () => {
  const path = await directory()
  for (let index = 0; index < 128; index++)
    await writeFeedback({
      identity,
      envelope: envelope(`event:${index}`),
      mode: 'interactive',
      outboxDirectory: path,
      env: {},
    })
  await expect(
    writeFeedback({
      identity,
      envelope: envelope('event:overflow'),
      mode: 'interactive',
      outboxDirectory: path,
      env: {},
    }),
  ).rejects.toThrow(/full.*retained/)
  expect(feedbackOutboxStatus(path)).toEqual({ status: 'pending', pendingCount: 128 })
  const files = await readdir(path)
  expect(files).toHaveLength(128)
  expect((await stat(join(path, files[0]!))).mode & 0o777).toBe(0o600)
}, 15_000)
it('rejects conflicting source records, corrupt persistence and unsafe private directory boundaries', async () => {
  const path = await directory()
  await writeFeedback({
    identity,
    envelope: envelope('event:1'),
    mode: 'interactive',
    outboxDirectory: path,
    env: {},
  })
  await expect(
    writeFeedback({
      identity,
      envelope: { ...envelope('event:1'), markdown: 'Changed unsent finding' },
      mode: 'interactive',
      outboxDirectory: path,
      env: {},
    }),
  ).rejects.toThrow(/conflicts/)
  expect(feedbackOutboxStatus(path).pendingCount).toBe(1)
  const file = (await readdir(path))[0]!
  await writeFile(join(path, file), 'malformed')
  expect(() => feedbackOutboxStatus(path)).toThrow()
  const unsafe = await directory()
  await chmod(unsafe, 0o755)
  expect(() => feedbackOutboxStatus(unsafe)).toThrow(/private/)
  const parent = await directory()
  await symlink(path, join(parent, 'linked'))
  expect(() => feedbackOutboxStatus(join(parent, 'linked'))).toThrow(/private/)
})

it('preserves idempotent pending records and prevents wrong-content delivery removal', async () => {
  const path = await directory()
  const record = { identity, envelope: envelope('same:source') }
  expect(persistFeedbackOutbox(path, record)).toBe(1)
  expect(persistFeedbackOutbox(path, { envelope: record.envelope, identity })).toBe(1)
  expect(() =>
    removeFeedbackOutbox(path, {
      ...record,
      envelope: { ...record.envelope, markdown: 'Changed' },
    }),
  ).toThrow(/changed/)
  expect(feedbackOutboxStatus(path).pendingCount).toBe(1)
  expect(removeFeedbackOutbox(path, record)).toEqual({ pendingCount: 0 })
  expect(removeFeedbackOutbox(path, record)).toEqual({ pendingCount: 0 })
  expect(feedbackOutboxStatus(join(path, 'not-created'))).toEqual({
    status: 'empty',
    pendingCount: 0,
  })
  expect(() => feedbackOutboxStatus('relative')).toThrow(/absolute/)
})
it('reads retained records without creating the directory', async () => {
  const path = await directory()
  const record = { identity, envelope: envelope('read:source') }
  expect(readFeedbackOutbox(join(path, 'not-created'))).toEqual([])
  expect(await readdir(path)).toEqual([])
  persistFeedbackOutbox(path, record)
  expect(readFeedbackOutbox(path)).toEqual([record])
  expect(() => readFeedbackOutbox('relative')).toThrow(/absolute/)
})
it('rejects oversized, unowned-mode, unrecognized and identity-mismatched persisted records', async () => {
  for (const mutation of [
    'oversize',
    'mode',
    'unknown-field',
    'identity-name',
    'temporary',
    'capacity',
  ]) {
    const path = await directory()
    const record = { identity, envelope: envelope('stored:source') }
    persistFeedbackOutbox(path, record)
    const file = (await readdir(path))[0]!
    if (mutation === 'oversize') await writeFile(join(path, file), 'x'.repeat(18001))
    if (mutation === 'mode') await chmod(join(path, file), 0o644)
    if (mutation === 'unknown-field')
      await writeFile(join(path, file), JSON.stringify({ ...record, raw: 'not allowed' }))
    if (mutation === 'identity-name')
      await rename(join(path, file), join(path, 'a'.repeat(64) + '.json'))
    if (mutation === 'temporary')
      await writeFile(join(path, '.persist-interrupted'), 'private interrupted persistence')
    if (mutation === 'capacity')
      for (let i = 0; i < 128; i++)
        await writeFile(join(path, `${String(i).padStart(64, '0')}.json`), 'unclassified')
    expect(() => feedbackOutboxStatus(path)).toThrow()
  }
})
it('refuses byte saturation without discarding previously retained records', async () => {
  const path = await directory()
  const large = createFeedbackEnvelope({
    ...envelope('large:base'),
    markdown: 'x'.repeat(12000),
    feedbackCoverage: {
      status: 'partial',
      sources: Array(25).fill('s'.repeat(140)),
      droppedCount: 0,
    },
  })
  let count = 0
  while (count < 128) {
    try {
      persistFeedbackOutbox(path, {
        identity,
        envelope: { ...large, sourceEventId: `large:${count}` },
      })
      count++
    } catch {
      break
    }
  }
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThan(128)
  expect(feedbackOutboxStatus(path).pendingCount).toBe(count)
  const extra = { identity, envelope: { ...large, sourceEventId: 'large:external' } }
  const name =
    createHash('sha256')
      .update(JSON.stringify([identity.sessionId, extra.envelope.sourceEventId]))
      .digest('hex') + '.json'
  await writeFile(join(path, name), JSON.stringify(extra), { mode: 0o600 })
  expect(() => feedbackOutboxStatus(path)).toThrow(/byte capacity/)
}, 15_000)
