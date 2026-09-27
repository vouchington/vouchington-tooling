import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createFeedbackEnvelope, feedbackOutboxStatus, writeFeedback } from './index.mts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const identity = {
  sessionId: 'native:session',
  parentSessionId: null,
  agent: 'codex',
  version: '1',
}
const input = () => ({
  schemaVersion: 1 as const,
  type: 'journal' as const,
  sourceEventId: 'event:1',
  timestamp: '2026-01-01T00:00:00.000Z',
  repositories: ['Owner/Repo'],
  markdown: 'A bounded finding',
  workOutcome: 'in-progress' as const,
  feedbackCoverage: { status: 'complete' as const, sources: ['tool-result'], droppedCount: 0 },
})
it('canonicalizes repository membership and protects bounded feedback from known secrets', () => {
  const envelope = createFeedbackEnvelope(
    { ...input(), markdown: 'Known secret abc-private' },
    { knownSensitiveValues: ['abc-private'] },
  )
  expect(envelope.repositories).toEqual(['owner/repo'])
  expect(envelope.markdown).toBe('Known secret [REDACTED]')
  expect(() => createFeedbackEnvelope({ ...input(), markdown: 'x'.repeat(20000) })).toThrow(
    /bounded|large/,
  )
})
it('keeps offline interactive records durable and visible rather than claiming delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackboard-outbox-'))
  directories.push(directory)
  const result = await writeFeedback({
    identity,
    envelope: createFeedbackEnvelope(input()),
    mode: 'interactive',
    outboxDirectory: directory,
    env: {},
  })
  expect(result).toMatchObject({ status: 'pending', pendingCount: 1, sourceEventId: 'event:1' })
  expect(feedbackOutboxStatus(directory)).toEqual({ status: 'pending', pendingCount: 1 })
  const files = await readdir(directory)
  expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(1)
  expect(
    await readFile(
      join(
        directory,
        files.find((file) => file.endsWith('.json'))!,
      ),
      'utf8',
    ),
  ).toContain('event:1')
})
it('fails autonomous delivery without creating an outbox and rejects unknown modes', async () => {
  await expect(
    writeFeedback({
      identity,
      envelope: createFeedbackEnvelope(input()),
      mode: 'autonomous',
      env: {},
    }),
  ).rejects.toThrow(/blackboard|Blackboard/)
  await expect(
    writeFeedback({
      identity,
      envelope: createFeedbackEnvelope(input()),
      mode: 'typo' as 'interactive',
      env: {},
    }),
  ).rejects.toThrow(/mode/)
})
