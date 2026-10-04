import { existsSync, readFileSync as readFileSyncFromDisk } from 'node:fs'

import { describe, expect, it } from 'vitest'

const repositoryUrl = (path: string) => new URL(`../../../${path}`, import.meta.url)
const readFileSync = (path: string, encoding: 'utf8') =>
  readFileSyncFromDisk(repositoryUrl(path), encoding)
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

describe('vouchington-tooling MCP repository configuration', () => {
  it('leaves server registration to the machine for Claude', () => {
    const settings = readJson('.claude/settings.json')

    expect(existsSync(repositoryUrl('.mcp.json'))).toBe(false)
    expect(settings.enabledPlugins).toEqual({ 'agent-blackboard@agent-blackboard': false })
    expect(settings.permissions).toEqual({ allow: ['mcp__vouchington-tooling__*'] })
  })

  it('leaves server registration to the machine for Codex', () => {
    const config = readFileSync('.codex/config.toml', 'utf8')

    expect(config).toBe('[plugins."agent-blackboard@agent-blackboard"]\nenabled = false\n')
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

  it('leaves machine policy to vouchington-machines', () => {
    const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8'))
    for (const key of ['sandbox', 'model', 'effortLevel', 'useAutoModeDuringPlan']) {
      expect(settings).not.toHaveProperty(key)
    }
    expect(settings.permissions).not.toHaveProperty('defaultMode')
    const config = readFileSync('.codex/config.toml', 'utf8')
    expect(config).not.toMatch(
      /^(?:sandbox_mode|approval_policy|approvals_reviewer|model|model_reasoning_effort)\s*=/mu,
    )
    expect(config).not.toContain('[sandbox_workspace_write]')
  })

  it('keeps the integration development-only in the published package', () => {
    const packageJson = readJson('packages/vouchington-tooling/package.json') as Record<
      string,
      Record<string, string> | undefined
    >

    expect(packageJson.devDependencies).toHaveProperty('agent-blackboard')
    expect(packageJson.dependencies?.['agent-blackboard']).toBeUndefined()
    expect(packageJson.optionalDependencies?.['agent-blackboard']).toBeUndefined()
    expect(packageJson.peerDependencies?.['agent-blackboard']).toBeDefined()
    expect(packageJson.peerDependenciesMeta?.['agent-blackboard']).toEqual({ optional: true })
  })
})
