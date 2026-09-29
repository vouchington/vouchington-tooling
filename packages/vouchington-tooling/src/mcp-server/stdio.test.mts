import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
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

  it('exits non-zero with the reason on stderr outside a git worktree', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'mcp'],
      cwd: fixture().root,
      stderr: 'pipe',
    })
    const stderr: string[] = []
    transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()))
    const client = new Client({ name: 'stdio-test', version: '1.0.0' })
    clients.push(client)
    await expect(client.connect(transport)).rejects.toThrow()
    expect(stderr.join('')).toContain('must be launched inside a git worktree')
  }, 30_000)
})
