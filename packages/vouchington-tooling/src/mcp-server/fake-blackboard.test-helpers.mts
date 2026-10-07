import type {
  BlackboardClientDependencies,
  BlackboardClientModule,
} from '../agent-blackboard/client.mts'

export const BLACKBOARD_ENV = {
  AGENT_BLACKBOARD_URL: 'https://provider.test',
  AGENT_BLACKBOARD_TOKEN: 'test-private-token',
}

type StoredEntry = { sessionId?: string; createdAt: string; data: unknown }

export type FakeOptions = {
  archived?: boolean
  omitArchive?: boolean
  omitSnapshots?: boolean
  exportResult?: unknown
  /** Makes `ensure` fail for any other identity, and `get` report a session with this one. */
  conflictingSession?: { id: string; parentSessionId: null; agent: string; version: string }
  entries?: StoredEntry[]
  entriesError?: unknown
  /** An entry another caller writes just before the next append, after that append's read. */
  lateEntry?: StoredEntry
}

export type FakeBlackboard = {
  dependencies: BlackboardClientDependencies
  calls: {
    ensure: unknown[]
    patch: unknown[]
    append: unknown[]
    get: unknown[]
    archive: string[]
    export: unknown[]
  }
  stored: StoredEntry[]
}

const SNAPSHOT = {
  path: '/private/snapshots/export.jsonl',
  counts: { sessions: 1, entries: 2, records: 3, bytes: 4 },
  checksum: { algorithm: 'sha256', value: 'abc' },
  manifest: { schemaVersion: 1 },
  cleanupToken: 'token',
}

/** An in-memory blackboard client faked at the module boundary `loadClient` provides. */
export function fakeBlackboard(options: FakeOptions = {}): FakeBlackboard {
  const calls: FakeBlackboard['calls'] = {
    ensure: [],
    patch: [],
    append: [],
    get: [],
    archive: [],
    export: [],
  }
  const stored = options.entries ?? []
  const data: { repositories: string[] } = { repositories: [] }
  class Sessions {
    async ensure(input: { parentSessionId: null; agent: string; version: string }) {
      calls.ensure.push(input)
      if (
        options.conflictingSession &&
        (options.conflictingSession.parentSessionId !== input.parentSessionId ||
          options.conflictingSession.agent !== input.agent ||
          options.conflictingSession.version !== input.version)
      )
        throw new Error('session identity differs')
      return {
        status: 'created' as const,
        session: { data, archivedAt: options.archived ? '2026-01-01T00:00:00.000Z' : null },
      }
    }
    async patch(input: unknown) {
      calls.patch.push(input)
      data.repositories = (input as { data: { repositories: string[] } }).data.repositories
    }
    async list() {}
    async get() {
      return options.conflictingSession
    }
    async archive(sessionId: string) {
      calls.archive.push(sessionId)
    }
  }
  if (options.omitArchive) delete (Sessions.prototype as { archive?: unknown }).archive
  let lateEntry = options.lateEntry
  class Entries {
    async append(input: unknown) {
      calls.append.push(input)
      if (lateEntry) stored.push(lateEntry)
      lateEntry = undefined
      const entry = {
        createdAt: `2026-01-01T00:00:${String(stored.length).padStart(2, '0')}.000Z`,
        data: (input as { data: unknown }).data,
      }
      stored.push(entry)
      return entry
    }
    async *get(input: unknown) {
      calls.get.push(input)
      if (options.entriesError !== undefined) throw options.entriesError
      yield* stored
    }
  }
  class Snapshots {
    async export(input: unknown) {
      calls.export.push(input)
      return 'exportResult' in options ? options.exportResult : SNAPSHOT
    }
  }
  const module: BlackboardClientModule = {
    Sessions,
    Entries,
    ...(options.omitSnapshots ? {} : { Snapshots }),
  }
  return { dependencies: { loadClient: async () => module }, calls, stored }
}
