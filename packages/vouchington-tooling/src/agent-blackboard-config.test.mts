import { readFileSync as readFileSyncFromDisk } from 'node:fs'

import { describe, expect, it } from 'vitest'

const readFileSync = (path: string, encoding: 'utf8') =>
  readFileSyncFromDisk(new URL(`../../../${path}`, import.meta.url), encoding)

const tools = [
  'entry_append',
  'entry_get',
  'session_archive',
  'session_create',
  'session_ensure',
  'session_patch',
  'session_search',
  'snapshot_export',
] as const

describe('agent-blackboard repository configuration', () => {
  it('pins the shared MCP server and forwards only client credentials', () => {
    const config = JSON.parse(readFileSync('.mcp.json', 'utf8')) as {
      mcpServers?: Record<string, { args?: string[]; env?: Record<string, string> }>
    }
    const server = config.mcpServers?.['agent-blackboard']
    const packageJson = JSON.parse(
      readFileSyncFromDisk(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { devDependencies?: Record<string, string> }
    const declaredVersion = packageJson.devDependencies?.['agent-blackboard']
    if (!declaredVersion) throw new Error('agent-blackboard must be a development dependency')

    expect(server?.args).toEqual([
      '-y',
      `agent-blackboard@${declaredVersion.replace(/^[~^]/u, '')}`,
      'mcp',
    ])
    expect(server?.env).toEqual({
      AGENT_BLACKBOARD_URL: '${AGENT_BLACKBOARD_URL}',
      AGENT_BLACKBOARD_TOKEN: '${AGENT_BLACKBOARD_TOKEN}',
    })
  })

  it('preauthorizes exactly the current tools for Claude', () => {
    const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8')) as {
      enabledMcpjsonServers?: string[]
      permissions?: { allow?: string[] }
    }

    expect(settings.enabledMcpjsonServers).toEqual(['agent-blackboard'])
    expect(settings.permissions?.allow?.toSorted()).toEqual(
      tools.map((tool) => `mcp__agent-blackboard__${tool}`).toSorted(),
    )
  })

  it('preauthorizes exactly the current tools for the Codex plugin', () => {
    const config = readFileSync('.codex/config.toml', 'utf8')
    const prefix =
      '[plugins."agent-blackboard@agent-blackboard".mcp_servers.agent-blackboard.tools.'

    for (const tool of tools) {
      expect(config).toContain(`${prefix}${tool}]\napproval_mode = "approve"`)
    }
    expect(config.match(/approval_mode = "approve"/g)).toHaveLength(tools.length)
  })

  it('keeps the integration development-only in the published package', () => {
    const packageJson = JSON.parse(
      readFileSync('packages/vouchington-tooling/package.json', 'utf8'),
    ) as Record<string, Record<string, string> | undefined>

    expect(packageJson.devDependencies).toHaveProperty('agent-blackboard')
    expect(packageJson.dependencies?.['agent-blackboard']).toBeUndefined()
    expect(packageJson.optionalDependencies?.['agent-blackboard']).toBeUndefined()
    expect(packageJson.peerDependencies?.['agent-blackboard']).toBeUndefined()
  })
})
