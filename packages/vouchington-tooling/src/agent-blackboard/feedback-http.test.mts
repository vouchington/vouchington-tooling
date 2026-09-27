import { fileURLToPath } from 'node:url'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  appendJournal,
  autonomousGate,
  createFeedbackEnvelope,
  feedbackOutboxStatus,
  flushFeedbackOutbox,
  writeFeedback,
  type BlackboardClientModule,
  type FeedbackEnvelope,
} from './index.mts'
const servers: Server[] = []
const directories: string[] = []
const originalCwd = process.cwd()
const dependencies = { resolveFrom: import.meta.url }
afterEach(async () => {
  vi.unstubAllEnvs()
  process.chdir(originalCwd)
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const identity = { sessionId: 'native:owner', parentSessionId: null, agent: 'codex', version: '1' }
function envelope(sourceEventId = 'source:one'): FeedbackEnvelope {
  return createFeedbackEnvelope({
    schemaVersion: 1,
    type: 'journal',
    sourceEventId,
    timestamp: '2026-01-01T00:00:00.000Z',
    repositories: ['owner/repo'],
    markdown: 'Observed useful outcome',
    workOutcome: 'success',
    feedbackCoverage: { status: 'complete', sources: ['tool-result'], droppedCount: 0 },
  })
}
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'feedback-http-'))
  directories.push(path)
  return path
}
async function provider(
  options: {
    loseAppendResponse?: boolean
    hideEntries?: boolean
    rejectPatch?: boolean
    reorder?: boolean
    duplicate?: boolean
    unauthorized?: boolean
    existingAgent?: string
  } = {},
) {
  const entries: Array<{ createdAt: string; data: unknown }> = []
  let session: Record<string, unknown> | undefined = options.existingAgent
    ? {
        id: identity.sessionId,
        parentSessionId: null,
        agent: options.existingAgent,
        version: '1',
        data: {},
        archivedAt: null,
      }
    : undefined
  let appends = 0
  const server = createServer(async (request, response) => {
    const body = []
    for await (const chunk of request) body.push(chunk)
    const input = body.length ? JSON.parse(Buffer.concat(body).toString()) : {}
    const path = new URL(request.url!, 'http://localhost').pathname
    response.setHeader('content-type', 'application/json')
    const send = (status: number, value: unknown) => {
      response.statusCode = status
      response.end(JSON.stringify(value))
    }
    if (options.unauthorized) return send(401, { error: 'private provider message' })
    if (request.method === 'POST' && path === '/sessions') {
      if (session) return send(409, { error: 'exists' })
      session = { ...input, data: {}, archivedAt: null }
      return send(201, session)
    }
    if (request.method === 'GET' && !path.endsWith('/entries')) return send(200, session)
    if (request.method === 'PATCH') {
      if (options.rejectPatch) return send(403, { error: 'secret patch error' })
      session = { ...session, data: input.data }
      return send(200, session)
    }
    if (request.method === 'POST') {
      appends++
      const data = options.reorder
        ? Object.fromEntries(Object.entries(input.data).reverse())
        : input.data
      const entry = { createdAt: `2026-01-01T00:00:0${appends}.000Z`, data }
      entries.push(entry)
      if (options.duplicate) entries.push({ ...entry, createdAt: '2026-01-01T00:00:09.000Z' })
      if (options.loseAppendResponse) {
        options.loseAppendResponse = false
        response.destroy()
        return
      }
      return send(201, entry)
    }
    const visible = options.hideEntries ? [] : entries
    response.setHeader('content-type', 'application/x-ndjson')
    response.end(visible.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing loopback address')
  return {
    env: {
      AGENT_BLACKBOARD_URL: `http://127.0.0.1:${address.port}`,
      AGENT_BLACKBOARD_TOKEN: 'private-test-token',
    },
    entries,
    get appends() {
      return appends
    },
    get session() {
      return session
    },
  }
}
it('requires real append/readback and accepts reordered keys and equivalent concurrent delivery', async () => {
  const service = await provider({ reorder: true, duplicate: true })
  const result = await writeFeedback({
    identity,
    envelope: envelope(),
    mode: 'autonomous',
    env: service.env,
    dependencies,
  })
  expect(result).toMatchObject({
    status: 'delivered',
    receipt: { sessionId: 'native:owner', sourceEventId: 'source:one', verified: true },
  })
  expect(service.session?.data).toEqual({ repositories: ['owner/repo'] })
  await expect(
    writeFeedback({
      identity,
      envelope: envelope(),
      mode: 'autonomous',
      env: service.env,
      dependencies,
    }),
  ).resolves.toMatchObject({ status: 'delivered' })
  expect(service.appends).toBe(1)
  await expect(
    autonomousGate({ identity, envelope: envelope(), env: service.env, dependencies }),
  ).rejects.toMatchObject({ diagnostic: 'event-conflict' })
  await expect(
    autonomousGate({ identity, envelope: envelope('fresh:gate'), env: service.env, dependencies }),
  ).resolves.toMatchObject({ status: 'delivered', receipt: { sourceEventId: 'fresh:gate' } })
  expect(service.appends).toBe(2)
})
it('replays a durable interactive record after a committed append lost its response', async () => {
  const service = await provider({ loseAppendResponse: true })
  const path = await directory()
  const result = await writeFeedback({
    identity,
    envelope: envelope(),
    mode: 'interactive',
    outboxDirectory: path,
    env: service.env,
    dependencies,
  })
  expect(result).toMatchObject({ status: 'pending', pendingCount: 1 })
  expect(service.appends).toBe(1)
  await expect(
    flushFeedbackOutbox({ directory: path, env: service.env, dependencies }),
  ).resolves.toEqual({
    status: 'empty',
    pendingCount: 0,
    deliveredCount: 1,
  })
  expect(service.appends).toBe(1)
  expect(feedbackOutboxStatus(path)).toEqual({ status: 'empty', pendingCount: 0 })
})
it('blocks unconfirmed, unauthorized and metadata-rejected writes without exposing provider errors', async () => {
  const hidden = await provider({ hideEntries: true })
  await expect(
    writeFeedback({
      identity,
      envelope: envelope(),
      mode: 'autonomous',
      env: hidden.env,
      dependencies,
    }),
  ).rejects.toMatchObject({ diagnostic: 'readback-unconfirmed' })
  const rejected = await provider({ rejectPatch: true })
  await expect(
    writeFeedback({
      identity,
      envelope: envelope(),
      mode: 'autonomous',
      env: rejected.env,
      dependencies,
    }),
  ).rejects.toMatchObject({ diagnostic: 'authentication-rejected' })
  expect(rejected.appends).toBe(0)
  const unauthorized = await provider({ unauthorized: true })
  const result = await writeFeedback({
    identity,
    envelope: envelope(),
    mode: 'interactive',
    outboxDirectory: await directory(),
    env: unauthorized.env,
    dependencies,
  })
  expect(result).toMatchObject({ status: 'pending', diagnostic: 'authentication-rejected' })
  expect(JSON.stringify(result)).not.toContain('private provider')
})
it('rejects a source identity collision without appending conflicting content', async () => {
  const service = await provider()
  await writeFeedback({
    identity,
    envelope: envelope(),
    mode: 'autonomous',
    env: service.env,
    dependencies,
  })
  await expect(
    writeFeedback({
      identity,
      envelope: { ...envelope(), markdown: 'Different finding' },
      mode: 'autonomous',
      env: service.env,
      dependencies,
    }),
  ).rejects.toMatchObject({ diagnostic: 'event-conflict' })
  expect(service.appends).toBe(1)
})
it('redacts configured default-env credentials before durable offline persistence', async () => {
  vi.stubEnv('AGENT_BLACKBOARD_TOKEN', 'local-configured-private-value')
  vi.stubEnv('AGENT_BLACKBOARD_URL', '')
  const path = await directory()
  await writeFeedback({
    identity,
    envelope: { ...envelope(), markdown: 'Finding local-configured-private-value' },
    mode: 'interactive',
    outboxDirectory: path,
  })
  const file = (await readdir(path)).find((name) => name.endsWith('.json'))!
  expect(await readFile(join(path, file), 'utf8')).not.toContain('local-configured-private-value')
})
it('times out an autonomous gate and never authorizes a late operation', async () => {
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const dependencies = {
    loadClient: async (): Promise<BlackboardClientModule> => ({
      Sessions: class {
        async ensure() {
          await waiting
          return { status: 'created', session: { data: { repositories: ['owner/repo'] } } } as const
        }
        async patch() {}
        async list() {}
        async get() {}
      },
      Entries: class {
        async append() {
          return { createdAt: 't' }
        }
        async *get() {}
      },
    }),
  }
  await expect(
    autonomousGate({
      identity,
      envelope: envelope('gate:timeout'),
      env: { AGENT_BLACKBOARD_URL: 'https://example.test', AGENT_BLACKBOARD_TOKEN: 'private' },
      dependencies,
      timeoutMs: 5,
    }),
  ).rejects.toMatchObject({ status: 'blocked', diagnostic: 'delivery-timeout' })
  release()
})
it('reads a note through the current public journal writer contract', async () => {
  const service = await provider()
  const path = join(await directory(), 'note.md')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, 'A public journal finding')
  const result = await appendJournal({
    ...identity,
    markdownFile: path,
    repositories: ['OWNER/REPO'],
    sourceEventId: 'journal:file',
    workOutcome: 'in-progress',
    feedbackCoverage: { status: 'partial', sources: ['note'], droppedCount: 0 },
    mode: 'autonomous',
    env: service.env,
    dependencies,
    timestamp: '2026-01-01T01:00:00+01:00',
  })
  expect(result).toMatchObject({ status: 'delivered', sourceEventId: 'journal:file' })
  expect(service.entries[0]?.data).toMatchObject({
    type: 'journal',
    repositories: ['owner/repo'],
    markdown: 'A public journal finding',
    timestamp: '2026-01-01T00:00:00.000Z',
  })
})
it('classifies actual SDK identity mismatches as hard conflicts while retaining interactive evidence', async () => {
  const service = await provider({ existingAgent: 'claude' })
  const path = await directory()
  await expect(
    writeFeedback({
      identity,
      envelope: envelope(),
      mode: 'interactive',
      outboxDirectory: path,
      env: service.env,
      dependencies,
    }),
  ).rejects.toMatchObject({ status: 'blocked', diagnostic: 'identity-conflict' })
  expect(service.appends).toBe(0)
  expect(feedbackOutboxStatus(path)).toEqual({ status: 'pending', pendingCount: 1 })
  await expect(
    flushFeedbackOutbox({ directory: path, env: service.env, dependencies }),
  ).resolves.toMatchObject({
    status: 'pending',
    pendingCount: 1,
    deliveredCount: 0,
    diagnostic: 'identity-conflict',
  })
})

it('delivers journal defaults and replays through the consumer context with default credentials', async () => {
  const service = await provider()
  vi.stubEnv('AGENT_BLACKBOARD_URL', service.env.AGENT_BLACKBOARD_URL)
  vi.stubEnv('AGENT_BLACKBOARD_TOKEN', service.env.AGENT_BLACKBOARD_TOKEN)
  const consumer = await directory()
  await mkdir(join(consumer, 'node_modules'))
  await symlink(
    fileURLToPath(new URL('../../node_modules/agent-blackboard', import.meta.url)),
    join(consumer, 'node_modules', 'agent-blackboard'),
    'dir',
  )
  process.chdir(consumer)
  const path = await directory()
  const note = join(await directory(), 'note.md')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(note, 'Finding with optional journal metadata')
  await expect(
    appendJournal({
      ...identity,
      parentSessionId: 'native:parent',
      markdownFile: note,
      repositories: ['owner/repo'],
      sourceEventId: 'journal:defaults',
      workOutcome: 'in-progress',
      feedbackCoverage: { status: 'partial', sources: ['note'], droppedCount: 0 },
      mode: 'interactive',
      outboxDirectory: path,
      category: 'tooling',
      timeoutMs: 20_000,
    }),
  ).resolves.toMatchObject({ status: 'delivered', pendingCount: 0 })
  expect(service.entries[0]?.data).toMatchObject({
    category: 'tooling',
    sourceEventId: 'journal:defaults',
  })
  expect(service.session).toMatchObject({ parentSessionId: 'native:parent' })
  const failed = await writeFeedback({
    identity: { ...identity, parentSessionId: 'native:parent' },
    envelope: envelope('replay:defaults'),
    mode: 'interactive',
    outboxDirectory: path,
    env: {},
  })
  expect(failed.status).toBe('pending')
  await expect(flushFeedbackOutbox({ directory: path })).resolves.toMatchObject({
    status: 'empty',
    deliveredCount: 1,
    pendingCount: 0,
  })
})

it('replays healthy records behind a permanent conflicting record while preserving the conflict', async () => {
  const service = await provider()
  const path = await directory()
  for (const id of ['blocked:one', 'healthy:two'])
    await writeFeedback({
      identity,
      envelope: envelope(id),
      mode: 'interactive',
      outboxDirectory: path,
      env: {},
    })
  const { listFeedbackOutbox } = await import('./feedback-outbox.mts')
  const records = listFeedbackOutbox(path)
  service.entries.push({
    createdAt: '2026-01-01T00:00:00.000Z',
    data: { ...records[0]!.envelope, markdown: 'Different retained provider finding' },
  })
  const result = await flushFeedbackOutbox({ directory: path, env: service.env, dependencies })
  expect(result).toMatchObject({
    status: 'pending',
    pendingCount: 1,
    deliveredCount: 1,
    diagnostic: 'event-conflict',
  })
  expect(listFeedbackOutbox(path)).toEqual([records[0]])
  expect(
    service.entries.some(
      (entry) => JSON.stringify(entry.data) === JSON.stringify(records[1]!.envelope),
    ),
  ).toBe(true)
})
