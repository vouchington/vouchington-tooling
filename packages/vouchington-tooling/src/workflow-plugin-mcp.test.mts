import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { useRepoFixture } from './mcp-server/harness.test-helpers.mts'

const plugin = new URL('../../../plugins/vouchington-workflow/', import.meta.url)
const cli = fileURLToPath(new URL('./cli/index.mts', import.meta.url))
const fixture = useRepoFixture()
const clients: Client[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

type Configuration = {
  mcpServers: Record<string, { type?: string; command: string; args: string[]; env?: object }>
}
const readConfiguration = async (name: string): Promise<Configuration> =>
  JSON.parse(await readFile(new URL(name, plugin), 'utf8')) as Configuration

it('registers a bundled launcher with host-specific path expansion and inherited credentials', async () => {
  const portable = await readConfiguration('mcp.json')
  const claude = await readConfiguration('.mcp.json')
  expect(Object.keys(portable.mcpServers)).toEqual(['vouchington-tooling'])
  expect(portable.mcpServers['vouchington-tooling']).toEqual({
    type: 'stdio',
    command: 'node',
    args: ['${PLUGIN_ROOT}/scripts/mcp.mjs'],
  })
  expect(claude.mcpServers['vouchington-tooling']).toEqual({
    command: 'node',
    args: ['${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs'],
  })
  for (const [host, config] of [
    ['codex', portable],
    ['claude', claude],
  ] as const) {
    const manifest = JSON.parse(
      await readFile(new URL(`.${host}-plugin/plugin.json`, plugin), 'utf8'),
    ) as { mcpServers: string }
    expect(await readConfiguration(manifest.mcpServers)).toEqual(config)
  }
})

it('launches from the portable plugin root with an explicit consumer and forwards real environment values', async () => {
  const server = (await readConfiguration('mcp.json')).mcpServers['vouchington-tooling']!
  const tooling = join(fixture().main, 'node_modules', 'vouchington-tooling')
  const blackboard = join(fixture().main, 'node_modules', 'agent-blackboard')
  await mkdir(tooling, { recursive: true })
  await mkdir(blackboard)
  await writeFile(join(fixture().main, 'package.json'), '{"private":true}')
  await writeFile(
    join(tooling, 'package.json'),
    JSON.stringify({
      name: 'vouchington-tooling',
      type: 'module',
      exports: { './package.json': './package.json' },
      bin: { vouchington: 'cli.mjs' },
    }),
  )
  await writeFile(
    join(tooling, 'cli.mjs'),
    `export { runCli } from '${new URL('./cli/index.mts', import.meta.url).href}'`,
  )
  await writeFile(join(blackboard, 'package.json'), '{"type":"module","exports":"./client.mjs"}')
  await writeFile(
    join(blackboard, 'client.mjs'),
    `
    export class Sessions {
      constructor(connection) {
        if (connection.baseUrl !== 'http://fixture.test' || connection.token !== 'fixture-token')
          throw new Error('host credentials were overwritten');
      }
      async ensure() { return { status: 'created', session: { data: {} } }; }
    }
  `,
  )
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args.map((arg) => arg.replace('${PLUGIN_ROOT}', fileURLToPath(plugin))),
    cwd: fileURLToPath(plugin),
    env: {
      PATH: process.env.PATH ?? '',
      MCP_WORKTREE: fixture().main,
      AGENT_BLACKBOARD_URL: 'http://fixture.test',
      AGENT_BLACKBOARD_TOKEN: 'fixture-token',
    },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'workflow-plugin-test', version: '1' })
  clients.push(client)
  await client.connect(transport)
  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('journal_append')
  const ensured = await client.callTool({
    name: 'session_ensure',
    arguments: {
      sessionId: 'test',
      parentSessionId: null,
      agent: 'codex',
      version: '1',
    },
  })
  expect(ensured.isError).not.toBe(true)
  const note = join(fixture().main, 'fallback.md')
  await writeFile(note, 'MCP unavailable; using the supported CLI fallback.', { mode: 0o600 })
  const directory = join(fixture().main, '.local', 'blackboard-outbox')
  const run = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [cli, 'agent-blackboard', 'journal', ...args],
      {
        cwd: fixture().main,
        env: { ...process.env, AGENT_BLACKBOARD_URL: '', AGENT_BLACKBOARD_TOKEN: '' },
      },
    )
    return JSON.parse(stdout) as Record<string, unknown>
  }
  for (const session of ['other', 'test']) {
    const result = await run(
      'append',
      '--session-id',
      session,
      '--agent',
      'codex',
      '--version',
      '1',
      '--mode',
      'interactive',
      '--source-event-id',
      `cli:${session}`,
      '--work-outcome',
      'unknown',
      '--repository',
      'owner/repo',
      '--coverage-status',
      'not-assessed',
      '--dropped-count',
      '0',
      '--outbox-directory',
      directory,
      '--file',
      note,
    )
    expect(result).toMatchObject({
      status: 'pending',
      pendingCount: 1,
      worktreePendingCount: session === 'other' ? 1 : 2,
    })
  }
  expect(
    await run('status', '--session-id', 'absent', '--outbox-directory', directory),
  ).toMatchObject({
    status: 'empty',
    pendingCount: 0,
    worktreePendingCount: 2,
  })
  expect(await run('flush', '--session-id', 'test', '--outbox-directory', directory)).toMatchObject(
    {
      status: 'pending',
      pendingCount: 1,
      worktreePendingCount: 2,
      deliveredCount: 0,
    },
  )
  const pending = await client.callTool({ name: 'outbox_status', arguments: { sessionId: 'test' } })
  expect(pending.content).toEqual([
    { type: 'text', text: expect.stringContaining('"worktreePendingCount": 2') },
  ])
}, 30_000)

it('reports missing consumer selection when launched from the plugin root', async () => {
  await expect(
    promisify(execFile)(process.execPath, [fileURLToPath(new URL('scripts/mcp.mjs', plugin))], {
      cwd: fileURLToPath(plugin),
      env: { ...process.env, MCP_WORKTREE: '' },
    }),
  ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Set MCP_WORKTREE') })
})
