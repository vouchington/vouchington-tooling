import { existsSync, readFileSync as readFileSyncFromDisk } from 'node:fs'

import { describe, expect, it } from 'vitest'

const repositoryUrl = (path: string) => new URL(`../../../${path}`, import.meta.url)
const readFileSync = (path: string, encoding: 'utf8') =>
  readFileSyncFromDisk(repositoryUrl(path), encoding)
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

const entrypoint = 'packages/vouchington-tooling/src/cli/index.mts'
const launcher = `exec node "$(git rev-parse --show-toplevel)/${entrypoint}" mcp`

describe('vouchington-tooling MCP repository configuration', () => {
  it('runs this repository`s own server from source and forwards only client credentials', () => {
    const config = readJson('.mcp.json') as {
      mcpServers?: Record<string, { command?: string; args?: string[]; env?: object }>
    }

    expect(Object.keys(config.mcpServers ?? {})).toEqual(['vouchington-tooling'])
    expect(config.mcpServers?.['vouchington-tooling']).toEqual({
      command: 'bash',
      args: ['-c', launcher],
      env: {
        AGENT_BLACKBOARD_URL: '${AGENT_BLACKBOARD_URL}',
        AGENT_BLACKBOARD_TOKEN: '${AGENT_BLACKBOARD_TOKEN}',
      },
    })
    expect(existsSync(repositoryUrl(entrypoint))).toBe(true)
  })

  it('approves the whole server for Claude and disables the upstream plugin', () => {
    const settings = readJson('.claude/settings.json')

    expect(settings.enabledMcpjsonServers).toEqual(['vouchington-tooling'])
    expect(settings.enabledPlugins).toEqual({ 'agent-blackboard@agent-blackboard': false })
    expect(settings.permissions).toEqual({ allow: ['mcp__vouchington-tooling__*'] })
  })

  it('approves the whole server for Codex and disables the upstream plugin', () => {
    const config = readFileSync('.codex/config.toml', 'utf8')

    expect(config).toContain('[plugins."agent-blackboard@agent-blackboard"]\nenabled = false\n')
    expect(config).toContain('[mcp_servers.vouchington-tooling]\ncommand = "bash"\n')
    expect(config).toContain(`'${launcher}'`)
    expect(config).toContain('env_vars = ["AGENT_BLACKBOARD_URL", "AGENT_BLACKBOARD_TOKEN"]')
    expect(config).toContain('default_tools_approval_mode = "approve"')
    expect(config).not.toContain('mcp_servers.agent-blackboard')
  })

  it('installs the client the server loads from the repository root', () => {
    const root = readJson('package.json') as { devDependencies?: Record<string, string> }
    const tooling = readJson('packages/vouchington-tooling/package.json') as {
      devDependencies?: Record<string, string>
    }

    expect(root.devDependencies?.['agent-blackboard']).toBe(
      tooling.devDependencies?.['agent-blackboard'],
    )
  })

  it('keeps the integration development-only in the published package', () => {
    const packageJson = readJson('packages/vouchington-tooling/package.json') as Record<
      string,
      Record<string, string> | undefined
    >

    expect(packageJson.devDependencies).toHaveProperty('agent-blackboard')
    expect(packageJson.dependencies?.['agent-blackboard']).toBeUndefined()
    expect(packageJson.optionalDependencies?.['agent-blackboard']).toBeUndefined()
    expect(packageJson.peerDependencies?.['agent-blackboard']).toBeUndefined()
  })
})
