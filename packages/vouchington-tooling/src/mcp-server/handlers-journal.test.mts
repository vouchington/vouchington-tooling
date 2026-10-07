import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  JOURNAL_ARGS,
  NOW,
  harness,
  jsonOf,
  outboxPath,
  textOf,
  useFixedClock,
  useRepoFixture,
} from './harness.test-helpers.mts'
import { TOOLS } from './tools.mts'

const fixture = useRepoFixture()
useFixedClock()
const required = TOOLS.find((tool) => tool.name === 'journal_append')?.inputSchema.required ?? []

describe('journal_append', () => {
  it('appends autonomously, returns the verified read-back, and creates no outbox', async () => {
    const h = harness(fixture())
    const result = await h.call('journal_append', JOURNAL_ARGS)
    expect(result.isError).toBeUndefined()
    expect(jsonOf(result)).toMatchObject({
      sessionId: 'native:owner',
      timestamp: NOW,
      status: 'delivered',
      sourceEventId: 'journal:1',
      pendingCount: 0,
      worktreePendingCount: 0,
      receipt: { sessionId: 'native:owner', sourceEventId: 'journal:1', verified: true },
    })
    expect(h.fake.calls.append).toHaveLength(1)
    expect(h.fake.calls.append[0]).toMatchObject({
      sessionId: 'native:owner',
      data: { type: 'journal', markdown: JOURNAL_ARGS.markdown, repositories: ['owner/repo'] },
    })
    expect(existsSync(outboxPath(fixture().main))).toBe(false)
  })

  it('mints the timestamp on the server, returns it, and accepts a category', async () => {
    const h = harness(fixture())
    const result = jsonOf(await h.call('journal_append', { ...JOURNAL_ARGS, category: 'tooling' }))
    expect(result.timestamp).toBe(NOW)
    expect(h.fake.calls.append[0]).toMatchObject({
      data: { timestamp: NOW, category: 'tooling' },
    })
  })

  it('derives the interactive outbox under the validated worktree', async () => {
    const h = harness(fixture(), { env: {} })
    const pending = jsonOf(
      await h.call('journal_append', {
        ...JOURNAL_ARGS,
        mode: 'interactive',
        worktree: fixture().linked,
      }),
    )
    expect(pending).toMatchObject({
      status: 'pending',
      pendingCount: 1,
      worktreePendingCount: 1,
      diagnostic: 'configuration-invalid',
      sessionId: 'native:owner',
    })
    expect(existsSync(outboxPath(fixture().linked))).toBe(true)
    expect(existsSync(outboxPath(fixture().main))).toBe(false)
    expect(
      jsonOf(
        await h.call('outbox_status', { sessionId: 'native:owner', worktree: fixture().linked }),
      ),
    ).toEqual({
      sessionId: 'native:owner',
      status: 'pending',
      pendingCount: 1,
      worktreePendingCount: 1,
      rejectedCount: 0,
      worktreeRejectedCount: 0,
    })
  })

  it('writes nothing when any required field is missing', async () => {
    for (const field of required.filter((name) => name !== 'sessionId')) {
      const h = harness(fixture(), { env: {} })
      const args: Record<string, unknown> = { ...JOURNAL_ARGS, mode: 'interactive' }
      delete args[field]
      const result = await h.call('journal_append', args)
      expect(result.isError, field).toBe(true)
      expect(textOf(result), field).toContain(field)
      expect(h.fake.calls.append, field).toEqual([])
      expect(h.fake.calls.ensure, field).toEqual([])
      expect(existsSync(outboxPath(fixture().main)), field).toBe(false)
    }
  })

  it('rejects malformed values before delivery', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ mode: 'batch' }, 'mode is required and must be one of'],
      [{ workOutcome: 'great' }, 'workOutcome is required and must be one of'],
      [{ markdown: '   ' }, 'markdown is required'],
      [{ markdown: 'x'.repeat(13000) }, 'bounded'],
      [{ repositories: [] }, 'repositories is required'],
      [{ repositories: [3] }, 'repositories is required'],
      [{ repositories: ['not a repo'] }, 'repositor'],
      [{ parentSessionId: undefined }, 'parentSessionId is required'],
      [{ parentSessionId: 'bad/parent' }, 'parent session id must be URL-safe'],
      [{ agent: '' }, 'agent is required'],
      [{ sourceEventId: 'has space' }, 'URL-safe'],
      [{ timestamp: NOW }, 'unsupported argument(s): timestamp'],
      [{ category: 3 }, 'category is required and must be a non-empty string'],
      [{ feedbackCoverage: 'complete' }, 'feedbackCoverage must be an object'],
      [{ feedbackCoverage: { status: 'complete', extra: 1 } }, 'unsupported argument(s): extra'],
      [{ feedbackCoverage: { status: 'done' } }, 'status is required and must be one of'],
      [{ feedbackCoverage: { status: 'complete', droppedCount: -1 } }, 'droppedCount'],
      [{ feedbackCoverage: { status: 'complete', sources: [1] } }, 'sources must be an array'],
    ]
    for (const [override, message] of cases) {
      const h = harness(fixture())
      const args: Record<string, unknown> = { ...JOURNAL_ARGS, ...override }
      const result = await h.call('journal_append', args)
      expect(result.isError, message).toBe(true)
      expect(textOf(result)).toContain(message)
      expect(h.fake.calls.append, message).toEqual([])
    }
  })

  it('defaults coverage sources and droppedCount', async () => {
    const h = harness(fixture())
    await h.call('journal_append', {
      ...JOURNAL_ARGS,
      feedbackCoverage: { status: 'not-assessed' },
    })
    expect(h.fake.calls.append[0]).toMatchObject({
      data: { feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 } },
    })
  })

  it('reports delivery failures as tool errors with an actionable hint', async () => {
    const offline = await harness(fixture(), { env: {} }).call('journal_append', JOURNAL_ARGS)
    expect(offline.isError).toBe(true)
    expect(textOf(offline)).toContain('configuration-invalid')
    expect(textOf(offline)).toContain('AGENT_BLACKBOARD_URL or AGENT_BLACKBOARD_TOKEN')

    const archived = await harness(fixture(), { archived: true }).call(
      'journal_append',
      JOURNAL_ARGS,
    )
    expect(textOf(archived)).toContain('the session is archived; write to a new session')

    const conflicting = await harness(fixture(), {
      conflictingSession: {
        id: 'native:owner',
        parentSessionId: null,
        agent: 'other',
        version: '1',
      },
    }).call('journal_append', JOURNAL_ARGS)
    expect(conflicting.isError).toBe(true)
    expect(textOf(conflicting)).toContain(
      'identity-conflict: agent stored "other", supplied "codex"',
    )
    expect(textOf(conflicting)).not.toContain('version stored')
    expect(textOf(conflicting)).toContain(
      'different parent or agent, or an unusable stored version',
    )
  })

  it('delivers a version-only mismatch into the stored session and reports storedVersion', async () => {
    const h = harness(fixture(), {
      conflictingSession: {
        id: 'native:owner',
        parentSessionId: null,
        agent: 'codex',
        version: 'unknown',
      },
    })
    const result = await h.call('journal_append', JOURNAL_ARGS)
    expect(result.isError).toBeUndefined()
    expect(jsonOf(result)).toMatchObject({
      status: 'delivered',
      storedVersion: 'unknown',
      receipt: { verified: true, storedVersion: 'unknown' },
    })
    expect(h.fake.calls.ensure.at(-1)).toMatchObject({ id: 'native:owner', version: 'unknown' })
    expect(h.fake.calls.append).toHaveLength(1)
  })

  it('rejects an interactive identity conflict without leaving a pending record', async () => {
    const h = harness(fixture(), {
      conflictingSession: {
        id: 'native:owner',
        parentSessionId: null,
        agent: 'other',
        version: '1',
      },
    })
    const result = await h.call('journal_append', {
      ...JOURNAL_ARGS,
      mode: 'interactive',
      worktree: fixture().linked,
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('agent stored "other", supplied "codex"')
    expect(
      jsonOf(
        await h.call('outbox_status', { sessionId: 'native:owner', worktree: fixture().linked }),
      ),
    ).toMatchObject({
      pendingCount: 0,
      worktreePendingCount: 0,
      rejectedCount: 1,
    })
  })

  it('names every differing field with its stored and supplied value', async () => {
    const h = harness(fixture(), {
      conflictingSession: {
        id: 'native:owner',
        parentSessionId: null,
        agent: 'other',
        version: 'unknown',
      },
    })
    const result = await h.call('journal_append', JOURNAL_ARGS)
    expect(textOf(result)).toContain(
      'agent stored "other", supplied "codex"; version stored "unknown", supplied "1"',
    )
    expect(h.fake.calls.append).toHaveLength(0)
  })

  it('refuses to reuse a sourceEventId for different content', async () => {
    const h = harness(fixture())
    await h.call('journal_append', JOURNAL_ARGS)
    const result = await h.call('journal_append', { ...JOURNAL_ARGS, markdown: 'A different note' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('use a new sourceEventId')
    expect(h.fake.calls.append).toHaveLength(1)
  })
})

const COVERAGE = { status: 'complete', sources: ['tool-result'], droppedCount: 0 }
const LEGACY_ENTRY = {
  sessionId: 'native:owner',
  createdAt: '2026-01-01T00:00:00.000Z',
  data: { note: 'investigating' },
}
const JOURNAL_ENTRY = {
  sessionId: 'native:owner',
  createdAt: '2026-01-01T00:00:01.000Z',
  data: {
    schemaVersion: 1,
    type: 'journal',
    sourceEventId: 'journal:1',
    timestamp: '2026-01-01T00:00:01.000Z',
    repositories: ['owner/repo'],
    markdown: 'The build cache was cold.',
    workOutcome: 'success',
    feedbackCoverage: COVERAGE,
    category: 'tooling',
  },
}
const RETROSPECTIVE_ENTRY = {
  sessionId: 'native:owner',
  createdAt: '2026-01-01T00:00:02.000Z',
  data: {
    schemaVersion: 1,
    type: 'retrospective',
    sourceEventId: 'retro:1',
    timestamp: '2026-01-01T00:00:02.000Z',
    repositories: ['owner/other', 'owner/repo'],
    markdown: '## Retrospective\nCache warm-up helped.',
    workOutcome: 'unknown',
    feedbackCoverage: { ...COVERAGE, status: 'partial', droppedCount: 2 },
    date: '2026-01-01',
    issues: [12],
    prs: ['owner/repo#3'],
  },
}

describe('journal_entries', () => {
  it('returns every entry unchanged, oldest first, whatever order the client yields', async () => {
    const h = harness(fixture(), {
      entries: [RETROSPECTIVE_ENTRY, LEGACY_ENTRY, JOURNAL_ENTRY],
    })
    const result = await h.call('journal_entries', { sessionId: 'native:owner' })
    expect(result.isError).toBeUndefined()
    expect(jsonOf(result)).toEqual({
      sessionId: 'native:owner',
      entries: [LEGACY_ENTRY, JOURNAL_ENTRY, RETROSPECTIVE_ENTRY],
    })
  })

  it('keeps the arrival order of entries created at the same time', async () => {
    const later = { ...JOURNAL_ENTRY, data: { ...JOURNAL_ENTRY.data, sourceEventId: 'journal:2' } }
    const h = harness(fixture(), { entries: [RETROSPECTIVE_ENTRY, later, JOURNAL_ENTRY] })
    const { entries } = jsonOf(await h.call('journal_entries', { sessionId: 'native:owner' }))
    expect(entries).toEqual([later, JOURNAL_ENTRY, RETROSPECTIVE_ENTRY])
  })

  it('never drops an entry that has no usable createdAt', async () => {
    const undated = { data: { note: 'undated' } } as never
    const h = harness(fixture(), { entries: [JOURNAL_ENTRY, undated] })
    const { entries } = jsonOf(await h.call('journal_entries', { sessionId: 'native:owner' }))
    expect(entries).toEqual([{ data: { note: 'undated' } }, JOURNAL_ENTRY])
  })

  it('returns what journal_append wrote with its whole envelope', async () => {
    const h = harness(fixture())
    await h.call('journal_append', { ...JOURNAL_ARGS, category: 'tooling' })
    const { entries } = jsonOf(await h.call('journal_entries', { sessionId: 'native:owner' }))
    expect(entries).toEqual([
      {
        createdAt: '2026-01-01T00:00:00.000Z',
        data: {
          schemaVersion: 1,
          type: 'journal',
          sourceEventId: 'journal:1',
          timestamp: NOW,
          repositories: ['owner/repo'],
          markdown: JOURNAL_ARGS.markdown,
          workOutcome: 'success',
          feedbackCoverage: COVERAGE,
          category: 'tooling',
        },
      },
    ])
  })

  it('reports an empty session as an empty list', async () => {
    const h = harness(fixture())
    expect(jsonOf(await h.call('journal_entries', { sessionId: 'native:owner' }))).toEqual({
      sessionId: 'native:owner',
      entries: [],
    })
  })

  it('turns a non-Error rejection into a tool error', async () => {
    const h = harness(fixture(), { entriesError: 'backend exploded' })
    const result = await h.call('journal_entries', { sessionId: 'native:owner' })
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'backend exploded' }] })
  })
})
