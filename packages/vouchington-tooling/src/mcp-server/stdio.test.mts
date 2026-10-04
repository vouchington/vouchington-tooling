import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { useRepoFixture } from './harness.test-helpers.mts'

const cli = fileURLToPath(new URL('../cli/index.mts', import.meta.url))
const fixture = useRepoFixture()
const clients: Client[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

describe('vouchington mcp over real stdio', () => {
  it('serves the tools from a spawned process and keeps stdout protocol-only', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'mcp'],
      cwd: fixture().main,
      stderr: 'pipe',
    })
    const client = new Client({ name: 'stdio-test', version: '1.0.0' })
    clients.push(client)
    await client.connect(transport)
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(7)
    const rejected = await client.callTool({
      name: 'journal_entries',
      arguments: { sessionId: 'native:owner', worktree: fixture().outside },
    })
    expect(rejected.isError).toBe(true)
  }, 30_000)

  it('starts outside a git worktree and accepts any explicit git worktree', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'mcp'],
      cwd: fixture().root,
      stderr: 'pipe',
    })
    const client = new Client({ name: 'stdio-test', version: '1.0.0' })
    clients.push(client)
    await client.connect(transport)
    const omitted = await client.callTool({
      name: 'outbox_status',
      arguments: { sessionId: 'native:owner' },
    })
    expect(omitted.isError).toBe(true)
    const subdirectory = await client.callTool({
      name: 'outbox_status',
      arguments: { sessionId: 'native:owner', worktree: join(fixture().main, 'nested') },
    })
    expect(subdirectory.isError).toBe(true)
    const accepted = await client.callTool({
      name: 'outbox_status',
      arguments: { sessionId: 'native:owner', worktree: fixture().outside },
    })
    expect(accepted.isError).toBeUndefined()
  }, 30_000)
})
