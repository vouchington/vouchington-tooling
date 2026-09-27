import { expect, it } from 'vitest'
import {
  createFeedbackEnvelope,
  validateFeedbackEnvelope,
  type FeedbackEnvelope,
} from './index.mts'
import { validateFeedbackIdentity } from './feedback-identity.mts'
const envelope = (): FeedbackEnvelope => ({
  schemaVersion: 1,
  type: 'journal',
  sourceEventId: 'event:1',
  timestamp: '2026-01-01T00:00:00.000Z',
  repositories: ['owner/repo'],
  markdown: 'A finding',
  workOutcome: 'unknown',
  feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
})
it('rejects coercible enum arrays and objects rather than trusting their string form', () => {
  for (const field of ['type', 'workOutcome'])
    for (const value of [[envelope()[field as 'type' | 'workOutcome']], {}, null, 1])
      expect(() => validateFeedbackEnvelope({ ...envelope(), [field]: value })).toThrow()
  for (const status of [['not-assessed'], {}, null, 1])
    expect(() =>
      validateFeedbackEnvelope({
        ...envelope(),
        feedbackCoverage: { status, sources: [], droppedCount: 0 },
      }),
    ).toThrow()
})
it('rejects missing attribution, unknown structured fields, invalid counters and bad dates', () => {
  for (const patch of [
    { repositories: [] },
    { repositories: ['OWNER/REPO'] },
    { repositories: ['invalid'] },
    { unexpected: 'raw payload' },
    { timestamp: 'bad' },
    { timestamp: '2026-01-01' },
    { sourceEventId: 'bad/path' },
    { markdown: '' },
    { markdown: '\ud800' },
    { markdown: 'x\u0000y' },
    { feedbackCoverage: { status: 'complete', sources: [], droppedCount: 1 } },
    { feedbackCoverage: { status: 'partial', sources: [], droppedCount: -1 } },
    { feedbackCoverage: { status: 'partial', sources: [42], droppedCount: 0 } },
    { feedbackCoverage: { status: 'partial', sources: [], droppedCount: 0, raw: 'secret' } },
  ])
    expect(() => validateFeedbackEnvelope({ ...envelope(), ...patch })).toThrow()
  const retrospective = {
    ...envelope(),
    type: 'retrospective' as const,
    date: '2026-01-01',
    issues: [1, 'owner/repo#2'],
    prs: [],
  }
  expect(() => validateFeedbackEnvelope(retrospective)).not.toThrow()
  for (const patch of [
    { date: '2026-02-30' },
    { date: '2026-01-01T00:00:00Z' },
    { issues: [0] },
    { issues: [{}] },
    { prs: 'none' },
  ])
    expect(() => validateFeedbackEnvelope({ ...retrospective, ...patch })).toThrow()
})
it('keeps narrative and legitimate token counts while redacting credentials and URL userinfo', () => {
  const value = createFeedbackEnvelope({
    ...envelope(),
    markdown:
      'Raw output was inspected locally. Tokens: input=120. Bearer abcdefgh. token=private. https://user:password@example.test/path',
  })
  expect(value.markdown).toContain('Raw output was inspected locally. Tokens: input=120.')
  expect(value.markdown).not.toContain('abcdefgh')
  expect(value.markdown).not.toContain('private')
  expect(value.markdown).not.toContain('user:password')
})
it('bounds parent identity and rejects control characters or invented extra identity fields', () => {
  const identity = {
    sessionId: 'native:owner',
    parentSessionId: null,
    agent: 'codex',
    version: '1',
  }
  for (const patch of [
    { parentSessionId: 'a'.repeat(257) },
    { parentSessionId: 'native:owner' },
    { agent: 'codex\nforged' },
    { version: '\ud800' },
    { runtimeSecret: 'private' },
  ])
    expect(() => validateFeedbackIdentity({ ...identity, ...patch })).toThrow()
})

it('enforces every structured bound and preserves valid canonical reference representations', () => {
  for (const patch of [
    { repositories: [42] },
    { repositories: ['o/'.padEnd(161, 'r')] },
    { repositories: Array.from({ length: 33 }, (_, i) => `owner/repo${i}`) },
    { sourceEventId: 'x'.repeat(257) },
    { feedbackCoverage: { status: 'partial', sources: 'raw', droppedCount: 0 } },
    { feedbackCoverage: { status: 'partial', sources: Array(33).fill('tool'), droppedCount: 0 } },
    { category: '' },
  ])
    expect(() => validateFeedbackEnvelope({ ...envelope(), ...patch })).toThrow()
  expect(() => validateFeedbackEnvelope(null)).toThrow()
  expect(() => validateFeedbackEnvelope({ ...envelope(), schemaVersion: 2 })).toThrow()
  expect(() => validateFeedbackEnvelope({ ...envelope(), type: 'unsupported' })).toThrow()
  expect(() => validateFeedbackEnvelope({ ...envelope(), issues: Array(65).fill(1) })).toThrow()
  const references = createFeedbackEnvelope(
    {
      ...envelope(),
      date: '2026-01-01',
      category: 'recovered',
      issues: [1, 'owner/repo#2'],
      prs: [3, 'owner/repo#4'],
      markdown: 'ghp_' + 'a'.repeat(40) + ' ' + 'b'.repeat(40),
    },
    { knownSensitiveValues: ['', 'abc'] },
  )
  expect(references.issues).toEqual([1, 'owner/repo#2'])
  expect(references.prs).toEqual([3, 'owner/repo#4'])
  expect(references.markdown).toBe('[REDACTED] ' + 'b'.repeat(40))
  expect(() => createFeedbackEnvelope({ ...envelope(), timestamp: 'invalid' })).toThrow()
  expect(() =>
    validateFeedbackEnvelope({
      ...envelope(),
      markdown: 'x'.repeat(12000),
      issues: Array(64).fill('x'.repeat(256)),
    }),
  ).toThrow(/too large/)
})
