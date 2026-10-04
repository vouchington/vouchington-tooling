import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { useRepoFixture } from './harness.test-helpers.mts'

const cli = fileURLToPath(new URL('../cli/index.mts', import.meta.url))
const fixture = useRepoFixture()
const clients: Client[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

const env = { PATH: process.env.PATH ?? '', AGENT_BLACKBOARD_URL: '', AGENT_BLACKBOARD_TOKEN: '' }

it('writes CLI fallback journal entries into the outbox the MCP server reads', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp'],
    cwd: fixture().main,
    env,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'cli-fallback-test', version: '1' })
  clients.push(client)
  await client.connect(transport)
  const status = () => client.callTool({ name: 'outbox_status', arguments: { sessionId: 'test' } })
  const empty = await status()
  expect(empty.isError).not.toBe(true)
  expect(empty.content).toEqual([
    { type: 'text', text: expect.stringContaining('"pendingCount": 0') },
  ])
  const note = join(fixture().main, 'fallback.md')
  await writeFile(note, 'MCP unavailable; using the supported CLI fallback.', { mode: 0o600 })
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      cli,
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
    { cwd: fixture().main, env },
  )
  expect(JSON.parse(stdout)).toMatchObject({ status: 'pending', pendingCount: 1 })
  expect((await status()).content).toEqual([
    { type: 'text', text: expect.stringContaining('"pendingCount": 1') },
  ])
}, 30_000)
