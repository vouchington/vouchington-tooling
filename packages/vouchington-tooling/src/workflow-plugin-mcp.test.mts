import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { useRepoFixture } from './mcp-server/harness.test-helpers.mts'

const plugin = new URL('../../../plugins/vouchington-workflow/', import.meta.url)
const fixture = useRepoFixture()
const clients: Client[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

type Configuration = {
  mcpServers: Record<string, { type?: string; command: string; args: string[]; env: object }>
}
const readConfiguration = async (name: string): Promise<Configuration> =>
  JSON.parse(await readFile(new URL(name, plugin), 'utf8')) as Configuration

it('registers the same server in portable, Codex and Claude plugin layouts', async () => {
  const legacy = await readConfiguration('.mcp.json')
  const portable = await readConfiguration('mcp.json')
  expect(Object.keys(legacy.mcpServers)).toEqual(['vouchington-tooling'])
  expect(portable.mcpServers['vouchington-tooling']).toEqual({
    type: 'stdio',
    ...legacy.mcpServers['vouchington-tooling'],
  })
  for (const name of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    const manifest = JSON.parse(await readFile(new URL(name, plugin), 'utf8')) as {
      mcpServers: string
    }
    expect(await readConfiguration(manifest.mcpServers)).toEqual(legacy)
  }
})

it('launches the plugin command and supports CLI fallback into the same outbox', async () => {
  const config = await readConfiguration('.mcp.json')
  const server = config.mcpServers['vouchington-tooling']!
  const bin = join(fixture().main, 'node_modules', '.bin')
  await mkdir(bin, { recursive: true })
  await writeFile(join(fixture().main, 'package.json'), '{"private":true}')
  await writeFile(
    join(bin, 'vouchington'),
    `#!/usr/bin/env node\nimport { runCli } from '${new URL('./cli/index.mts', import.meta.url).href}'\nprocess.exitCode = await runCli()\n`,
    { mode: 0o755 },
  )
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: fixture().main,
    env: { PATH: process.env.PATH ?? '', AGENT_BLACKBOARD_URL: '', AGENT_BLACKBOARD_TOKEN: '' },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'workflow-plugin-test', version: '1' })
  clients.push(client)
  await client.connect(transport)
  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('journal_append')
  const result = await client.callTool({ name: 'outbox_status', arguments: { sessionId: 'test' } })
  expect(result.isError).not.toBe(true)
  expect(result.content).toEqual([
    { type: 'text', text: expect.stringContaining('"pendingCount": 0') },
  ])
  const note = join(fixture().main, 'fallback.md')
  await writeFile(note, 'MCP unavailable; using the supported CLI fallback.', { mode: 0o600 })
  const { stdout } = await promisify(execFile)(
    server.command,
    [
      'exec',
      'vouchington',
      'agent-blackboard',
      'journal',
      'append',
      '--session-id',
      'test',
      '--agent',
      'codex',
      '--version',
      '1',
      '--mode',
      'interactive',
      '--source-event-id',
      'cli:fallback',
      '--work-outcome',
      'unknown',
      '--repository',
      'owner/repo',
      '--coverage-status',
      'not-assessed',
      '--dropped-count',
      '0',
      '--outbox-directory',
      join(fixture().main, '.local', 'blackboard-outbox'),
      '--file',
      note,
    ],
    {
      cwd: fixture().main,
      env: { ...process.env, AGENT_BLACKBOARD_URL: '', AGENT_BLACKBOARD_TOKEN: '' },
    },
  )
  expect(JSON.parse(stdout)).toMatchObject({ status: 'pending', pendingCount: 1 })
  const pending = await client.callTool({ name: 'outbox_status', arguments: { sessionId: 'test' } })
  expect(pending.content).toEqual([
    { type: 'text', text: expect.stringContaining('"pendingCount": 1') },
  ])
}, 30_000)
