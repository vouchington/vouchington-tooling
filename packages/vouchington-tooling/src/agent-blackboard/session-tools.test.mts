import { describe, expect, it } from 'vitest'
import type { BlackboardClientDependencies } from './client.mts'
import {
  archiveBlackboardSession,
  ensureBlackboardSession,
  exportSnapshot,
} from './session-tools.mts'

const env = { AGENT_BLACKBOARD_URL: 'https://provider.test', AGENT_BLACKBOARD_TOKEN: 'token' }
const identity = { sessionId: 'native:owner', parentSessionId: null, agent: 'codex', version: '1' }

type Recorded = { ensure: unknown[]; archive: string[]; export: unknown[] }

function fakeClient(
  options: { archivedAt?: string | null; withArchive?: boolean; snapshot?: unknown } = {},
) {
  const calls: Recorded = { ensure: [], archive: [], export: [] }
  const { archivedAt = null, withArchive = true } = options
  class Sessions {
    async ensure(input: unknown) {
      calls.ensure.push(input)
      return { status: 'exists' as const, session: { data: {}, archivedAt } }
    }
    async patch() {}
    async list() {}
    async get() {}
  }
  class ArchivingSessions extends Sessions {
    async archive(id: string) {
      calls.archive.push(id)
    }
  }
  class Entries {
    async append() {
      return { createdAt: '', data: null }
    }
    async *get() {}
  }
  class Snapshots {
    async export(input: unknown) {
      calls.export.push(input)
      return 'snapshot' in options ? options.snapshot : { path: '/private/export.jsonl' }
    }
  }
  const dependencies: BlackboardClientDependencies = {
    loadClient: async () => ({
      Sessions: withArchive ? ArchivingSessions : Sessions,
      Entries,
      Snapshots,
    }),
  }
  return { calls, dependencies }
}

describe('ensureBlackboardSession', () => {
  it('ensures the session with the validated identity and reports archive state', async () => {
    const { calls, dependencies } = fakeClient({ archivedAt: '2026-01-01T00:00:00.000Z' })
    await expect(ensureBlackboardSession({ ...identity, env, dependencies })).resolves.toEqual({
      sessionId: 'native:owner',
      status: 'exists',
      archived: true,
    })
    expect(calls.ensure).toEqual([
      { id: 'native:owner', parentSessionId: null, agent: 'codex', version: '1' },
    ])
    const open = fakeClient()
    expect((await ensureBlackboardSession({ ...identity, env, ...open })).archived).toBe(false)
  })

  it('rejects an unsafe identity before resolving credentials', async () => {
    const { calls, dependencies } = fakeClient()
    await expect(
      ensureBlackboardSession({ ...identity, sessionId: '../x', env: {}, dependencies }),
    ).rejects.toThrow('URL-safe')
    expect(calls.ensure).toEqual([])
  })
})

describe('archiveBlackboardSession', () => {
  it('archives the session', async () => {
    const { calls, dependencies } = fakeClient()
    await expect(
      archiveBlackboardSession({ sessionId: 'native:owner', env, dependencies }),
    ).resolves.toEqual({ sessionId: 'native:owner', archived: true })
    expect(calls.archive).toEqual(['native:owner'])
  })

  it('validates the id and explains how to upgrade a client that cannot archive', async () => {
    const { dependencies } = fakeClient({ withArchive: false })
    await expect(archiveBlackboardSession({ sessionId: 'a/b', env, dependencies })).rejects.toThrow(
      'URL-safe',
    )
    await expect(
      archiveBlackboardSession({ sessionId: 'native:owner', env, dependencies }),
    ).rejects.toThrow('cannot archive sessions; upgrade agent-blackboard')
  })
})

describe('exportSnapshot', () => {
  it('exports without a selection or a caller-chosen path by default', async () => {
    const { calls, dependencies } = fakeClient()
    await expect(exportSnapshot({ env, dependencies })).resolves.toEqual({
      path: '/private/export.jsonl',
    })
    expect(calls.export).toEqual([{}])
  })

  it('forwards the selection', async () => {
    const { calls, dependencies } = fakeClient()
    await exportSnapshot({ env, dependencies, selection: { agent: 'codex' } })
    expect(calls.export).toEqual([{ selection: { agent: 'codex' } }])
  })

  it('rejects a client without snapshots and a result without a path', async () => {
    const old: BlackboardClientDependencies = {
      loadClient: async () => {
        const { Sessions, Entries } = await fakeClient().dependencies.loadClient!()
        return { Sessions, Entries }
      },
    }
    await expect(exportSnapshot({ env, dependencies: old })).rejects.toThrow(
      'cannot export snapshots; upgrade agent-blackboard',
    )
    for (const snapshot of [null, 'text', { path: 1 }])
      await expect(exportSnapshot({ env, ...fakeClient({ snapshot }) })).rejects.toThrow(
        'unexpected snapshot export result',
      )
  })
})
