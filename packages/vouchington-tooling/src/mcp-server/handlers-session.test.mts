import { describe, expect, it } from 'vitest'
import { harness, jsonOf, textOf, useRepoFixture } from './harness.test-helpers.mts'

const fixture = useRepoFixture()
const identity = { sessionId: 'native:owner', parentSessionId: null, agent: 'codex', version: '1' }

describe('session_ensure', () => {
  it('creates the session and returns its identity, status, and archive state', async () => {
    const h = harness(fixture())
    expect(jsonOf(await h.call('session_ensure', identity))).toEqual({
      sessionId: 'native:owner',
      status: 'created',
      archived: false,
    })
    expect(h.fake.calls.ensure).toEqual([
      { id: 'native:owner', parentSessionId: null, agent: 'codex', version: '1' },
    ])
    const archived = harness(fixture(), { archived: true })
    expect(jsonOf(await archived.call('session_ensure', identity)).archived).toBe(true)
  })

  it('accepts a parent session and rejects a self-parent', async () => {
    const h = harness(fixture())
    await h.call('session_ensure', { ...identity, parentSessionId: 'native:parent' })
    expect(h.fake.calls.ensure[0]).toMatchObject({ parentSessionId: 'native:parent' })
    const self = await h.call('session_ensure', { ...identity, parentSessionId: 'native:owner' })
    expect(self.isError).toBe(true)
    expect(textOf(self)).toContain('cannot parent itself')
  })

  it('requires the full identity and calls nothing without it', async () => {
    for (const field of ['parentSessionId', 'agent', 'version']) {
      const h = harness(fixture())
      const args: Record<string, unknown> = { ...identity }
      delete args[field]
      const result = await h.call('session_ensure', args)
      expect(result.isError, field).toBe(true)
      expect(textOf(result)).toContain(field)
      expect(h.fake.calls.ensure).toEqual([])
    }
  })

  it('surfaces client failures as tool errors', async () => {
    const h = harness(fixture(), {
      conflictingSession: {
        id: 'native:owner',
        parentSessionId: null,
        agent: 'other',
        version: '1',
      },
    })
    const result = await h.call('session_ensure', identity)
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'session identity differs' }],
    })
  })

  it('reports missing blackboard credentials', async () => {
    const result = await harness(fixture(), { env: {} }).call('session_ensure', identity)
    expect(textOf(result)).toContain('AGENT_BLACKBOARD_URL is not set')
  })
})

describe('session_archive', () => {
  it('archives the named session and returns it', async () => {
    const h = harness(fixture())
    expect(jsonOf(await h.call('session_archive', { sessionId: 'native:owner' }))).toEqual({
      sessionId: 'native:owner',
      archived: true,
    })
    expect(h.fake.calls.archive).toEqual(['native:owner'])
  })

  it('tells the caller to upgrade agent-blackboard when the client cannot archive', async () => {
    const h = harness(fixture(), { omitArchive: true })
    const result = await h.call('session_archive', { sessionId: 'native:owner' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('upgrade agent-blackboard in the consumer package')
  })
})

describe('snapshot_export', () => {
  it('exports without a selection and never passes a destination path', async () => {
    const h = harness(fixture())
    const result = jsonOf(await h.call('snapshot_export', { sessionId: 'native:owner' }))
    expect(result).toMatchObject({
      sessionId: 'native:owner',
      path: '/private/snapshots/export.jsonl',
      counts: { sessions: 1, entries: 2, records: 3, bytes: 4 },
      cleanupToken: 'token',
    })
    expect(h.fake.calls.export).toEqual([{}])
  })

  it('maps the selection arguments to the client selection', async () => {
    const h = harness(fixture())
    await h.call('snapshot_export', {
      sessionId: 'native:owner',
      agent: 'codex',
      version: '1',
      parentSessionId: null,
      data: { repo: 'owner/repo' },
      dataArrayContains: { repositories: 'owner/repo' },
      inactiveForHours: 24,
    })
    expect(h.fake.calls.export).toEqual([
      {
        selection: {
          agent: 'codex',
          version: '1',
          parentSessionId: null,
          data: { repo: 'owner/repo' },
          dataArrayContains: { repositories: 'owner/repo' },
          inactiveForHours: 24,
        },
      },
    ])
  })

  it('rejects malformed selections before exporting', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ inactiveForHours: 0 }, 'inactiveForHours must be a positive number'],
      [{ inactiveForHours: 'soon' }, 'inactiveForHours must be a positive number'],
      [{ data: [] }, 'data must be an object'],
      [{ dataArrayContains: { repositories: 3 } }, 'only string values'],
      [{ parentSessionId: '' }, 'parentSessionId is required'],
      [{ agent: '' }, 'agent is required'],
    ]
    for (const [override, message] of cases) {
      const h = harness(fixture())
      const result = await h.call('snapshot_export', { sessionId: 'native:owner', ...override })
      expect(result.isError, message).toBe(true)
      expect(textOf(result)).toContain(message)
      expect(h.fake.calls.export).toEqual([])
    }
  })

  it('reports a client without snapshot support and a malformed export result', async () => {
    const old = await harness(fixture(), { omitSnapshots: true }).call('snapshot_export', {
      sessionId: 'native:owner',
    })
    expect(textOf(old)).toContain('cannot export snapshots; upgrade agent-blackboard')
    for (const exportResult of [null, 'text', { path: 7 }]) {
      const result = await harness(fixture(), { exportResult }).call('snapshot_export', {
        sessionId: 'native:owner',
      })
      expect(textOf(result)).toContain('unexpected snapshot export result')
    }
  })
})
