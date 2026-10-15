import { beforeEach, describe, expect, it } from 'vitest'
import {
  harness,
  JOURNAL_ARGS,
  jsonOf,
  textOf,
  useFixedClock,
  useRepoFixture,
} from './harness.test-helpers.mts'
import { previewRegistry } from './preview-registry.mts'

const fixture = useRepoFixture()
useFixedClock()
beforeEach(() => previewRegistry.clear())

const SECRET = 'key-abcd1234'
const { markdown: _m, sourceEventId: _s, ...BASE } = JOURNAL_ARGS
const FRONT = (sources: string[]) =>
  [
    '---',
    'date: "2026-01-01"',
    'issues: [12]',
    'prs: [5]',
    'work_outcome: "success"',
    `feedback_coverage: ${JSON.stringify({ status: 'complete', sources, droppedCount: 0 })}`,
    '---',
    '',
    `Body mentions ${SECRET}.`,
  ].join('\n')
const SAVE = {
  ...BASE,
  feedbackCoverage: { status: 'complete', sources: [SECRET], droppedCount: 0 },
  category: `about ${SECRET}`,
  markdown: FRONT([SECRET]),
  knownSensitiveValues: [SECRET],
}
const TOKEN_SAVE = {
  sessionId: BASE.sessionId,
  parentSessionId: null,
  agent: 'codex',
  version: '1',
  mode: 'autonomous',
}

async function preview(h: ReturnType<typeof harness>, extra = {}) {
  const result = await h.call('retrospective_save', { ...SAVE, dryRun: true, ...extra })
  expect(result.isError).toBeUndefined()
  return jsonOf(result).previewToken as string
}

describe('retrospective_save markdown knownSensitiveValues', () => {
  it('redacts markdown, category and feedbackCoverage in a dry run then a markdown save', async () => {
    const h = harness(fixture())
    const dry = jsonOf(await h.call('retrospective_save', { ...SAVE, dryRun: true }))
    expect(JSON.stringify(dry)).not.toContain(SECRET)
    const saved = await h.call('retrospective_save', SAVE)
    expect(saved.isError).toBeUndefined()
    expect(h.fake.stored).toHaveLength(1)
    expect(JSON.stringify(h.fake.stored)).not.toContain(SECRET)
    expect(h.fake.stored[0]!.data).toMatchObject({ category: 'about [REDACTED]' })
  })

  it('redacts a value used only in the category', async () => {
    const h = harness(fixture())
    const result = await h.call('retrospective_save', {
      ...BASE,
      markdown: FRONT(['tool-result']).replace(SECRET, 'nothing'),
      category: `about ${SECRET}`,
      knownSensitiveValues: [SECRET],
    })
    expect(result.isError).toBeUndefined()
    expect(JSON.stringify(h.fake.stored)).not.toContain(SECRET)
  })

  it('rejects bad values and a top-level list beside compose', async () => {
    const h = harness(fixture())
    const bad = await h.call('retrospective_save', { ...SAVE, knownSensitiveValues: ['abc'] })
    expect(textOf(bad)).toContain('at least 4 characters')
    const both = await h.call('retrospective_save', {
      ...BASE,
      compose: {},
      knownSensitiveValues: [SECRET],
    })
    expect(textOf(both)).toContain('inside compose')
  })
})

describe('retrospective_save previewToken', () => {
  it('saves exactly the previewed, redacted content, once', async () => {
    const h = harness(fixture())
    const token = await preview(h)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(h.fake.calls.append).toEqual([])
    const saved = await h.call('retrospective_save', { ...TOKEN_SAVE, previewToken: token })
    expect(saved.isError).toBeUndefined()
    expect(jsonOf(saved)).toMatchObject({ status: 'delivered', policy: { warnings: [] } })
    expect(h.fake.stored).toHaveLength(1)
    const data = h.fake.stored[0]!.data as Record<string, unknown>
    expect(data).toMatchObject({
      type: 'retrospective',
      sourceEventId: 'retrospective-native:owner',
      category: 'about [REDACTED]',
      feedbackCoverage: { status: 'complete', sources: ['[REDACTED]'], droppedCount: 0 },
    })
    expect(data.markdown).toContain('Body mentions [REDACTED].')
    expect(JSON.stringify(h.fake.stored)).not.toContain(SECRET)
    const again = await h.call('retrospective_save', { ...TOKEN_SAVE, previewToken: token })
    expect(textOf(again)).toContain('previewToken is unknown, already used')
    expect(h.fake.stored).toHaveLength(1)
  })

  it('rejects a token for another session, worktree or event, without spending it', async () => {
    const h = harness(fixture())
    const token = await preview(h)
    const call = (extra: Record<string, unknown>) =>
      h.call('retrospective_save', { ...TOKEN_SAVE, previewToken: token, ...extra })
    for (const extra of [
      { sessionId: 'native:other' },
      { parentSessionId: 'native:parent' },
      { mode: 'interactive' },
      { worktree: fixture().linked },
      { sourceEventId: 'other-event' },
    ])
      expect(textOf(await call(extra))).toContain('previewToken is unknown')
    expect((await call({})).isError).toBeUndefined()
  })

  it('rejects every token after a restart', async () => {
    const h = harness(fixture())
    const token = await preview(h)
    previewRegistry.clear()
    const result = await h.call('retrospective_save', { ...TOKEN_SAVE, previewToken: token })
    expect(textOf(result)).toContain('previewToken is unknown')
    expect(h.fake.stored).toEqual([])
  })

  it('binds a custom sourceEventId', async () => {
    const h = harness(fixture())
    const token = await preview(h, { sourceEventId: 'custom-1' })
    const wrong = await h.call('retrospective_save', { ...TOKEN_SAVE, previewToken: token })
    expect(textOf(wrong)).toContain('previewToken is unknown')
    const ok = await h.call('retrospective_save', {
      ...TOKEN_SAVE,
      previewToken: token,
      sourceEventId: 'custom-1',
    })
    expect(ok.isError).toBeUndefined()
  })

  it('refuses content beside the token', async () => {
    const h = harness(fixture())
    const token = await preview(h)
    for (const extra of [{ markdown: 'x' }, { workOutcome: 'success' }, { dryRun: true }]) {
      const result = await h.call('retrospective_save', {
        ...TOKEN_SAVE,
        previewToken: token,
        ...extra,
      })
      expect(textOf(result)).toContain('unsupported argument(s)')
    }
    const ok = await h.call('retrospective_save', { ...TOKEN_SAVE, previewToken: token })
    expect(ok.isError).toBeUndefined()
  })

  it('keeps the token usable when the write fails', async () => {
    const h = harness(fixture())
    await h.call('retrospective_save', { ...BASE, markdown: FRONT(['tool-result']) })
    const token = await preview(h)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await h.call('retrospective_save', { ...TOKEN_SAVE, previewToken: token })
      expect(result.isError).toBe(true)
      expect(textOf(result)).not.toContain('previewToken is unknown')
    }
  })
})
