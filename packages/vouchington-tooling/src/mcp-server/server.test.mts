import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { BLACKBOARD_ENV, fakeBlackboard } from './fake-blackboard.test-helpers.mts'
import { JOURNAL_ARGS, useRepoFixture } from './harness.test-helpers.mts'
import { runMcpServer } from './run.mts'
import { SERVER_NAME } from './server.mts'
import { TOOLS } from './tools.mts'

const fixture = useRepoFixture()
const clients: Client[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

async function connect() {
  const fake = fakeBlackboard()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await runMcpServer({
    cwd: fixture().main,
    env: BLACKBOARD_ENV,
    version: '9.8.7',
    transport: serverTransport,
    blackboard: fake.dependencies,
  })
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  clients.push(client)
  await client.connect(clientTransport)
  return { client, fake }
}

const textOf = (result: unknown) =>
  (result as { content: Array<{ text: string }> }).content.map((part) => part.text).join('\n')

describe('in-process client and server round trip', () => {
  it('identifies the server and advertises exactly the tool list with input schemas', async () => {
    const { client } = await connect()
    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: '9.8.7' })
    expect(client.getServerCapabilities()).toMatchObject({ tools: {} })
    expect(client.getInstructions()).toContain('explicit sessionId')
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual([
      'journal_append',
      'journal_entries',
      'outbox_status',
      'outbox_flush',
      'session_ensure',
      'snapshot_export',
      'session_archive',
    ])
    expect(tools.map((tool) => tool.inputSchema)).toEqual(TOOLS.map((tool) => tool.inputSchema))
    expect(tools.find((tool) => tool.name === 'session_archive')?.annotations).toMatchObject({
      destructiveHint: true,
    })
  })

  it('appends a journal entry and reads it back through the protocol', async () => {
    const { client, fake } = await connect()
    const appended = await client.callTool({
      name: 'journal_append',
      arguments: { ...JOURNAL_ARGS, mode: 'interactive' },
    })
    expect(appended.isError).toBeUndefined()
    expect(JSON.parse(textOf(appended))).toMatchObject({
      sessionId: 'native:owner',
      status: 'delivered',
      receipt: { verified: true },
    })
    expect(fake.calls.append).toHaveLength(1)
    const entries = await client.callTool({
      name: 'journal_entries',
      arguments: { sessionId: 'native:owner' },
    })
    expect(JSON.parse(textOf(entries))).toMatchObject({
      sessionId: 'native:owner',
      entries: [{ data: { type: 'journal', markdown: JOURNAL_ARGS.markdown } }],
    })
    const status = await client.callTool({
      name: 'outbox_status',
      arguments: { sessionId: 'native:owner' },
    })
    expect(JSON.parse(textOf(status))).toEqual({
      sessionId: 'native:owner',
      status: 'empty',
      pendingCount: 0,
    })
  })

  it('returns validation failures as tool errors instead of protocol errors', async () => {
    const { client, fake } = await connect()
    const invalid = await client.callTool({
      name: 'journal_append',
      arguments: { sessionId: 'native:owner' },
    })
    expect(invalid.isError).toBe(true)
    expect(textOf(invalid)).toContain('parentSessionId is required')
    const outside = await client.callTool({
      name: 'session_archive',
      arguments: { sessionId: 'native:owner', worktree: fixture().outside },
    })
    expect(outside.isError).toBe(true)
    expect(textOf(outside)).toContain('is not a worktree of the repository')
    const unknown = await client.callTool({ name: 'entry_append', arguments: {} })
    expect(unknown.isError).toBe(true)
    expect(fake.calls.archive).toEqual([])
  })
})

describe('runMcpServer defaults', () => {
  it('loads the consumer client itself when no test client is injected', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await runMcpServer({
      cwd: fixture().main,
      env: {},
      version: '1',
      transport: serverTransport,
    })
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    clients.push(client)
    await client.connect(clientTransport)
    const result = await client.callTool({
      name: 'session_archive',
      arguments: { sessionId: 'native:owner' },
    })
    expect(result.isError).toBe(true)
  })
})

describe('runMcpServer startup', () => {
  it('fails with an install hint when the SDK is missing', async () => {
    const missing = Object.assign(new Error('not found'), { code: 'ERR_MODULE_NOT_FOUND' })
    await expect(
      runMcpServer({
        cwd: fixture().main,
        env: {},
        version: '1',
        importSdk: async () => {
          throw missing
        },
      }),
    ).rejects.toThrow('pnpm add -D @modelcontextprotocol/sdk zod')
  })

  it('fails when launched outside a git worktree', async () => {
    const [, serverTransport] = InMemoryTransport.createLinkedPair()
    await expect(
      runMcpServer({ cwd: fixture().root, env: {}, version: '1', transport: serverTransport }),
    ).rejects.toThrow('must be launched inside a git worktree')
  })
})
