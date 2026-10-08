import { existsSync, readFileSync as readFileSyncFromDisk } from 'node:fs'

import { describe, expect, it } from 'vitest'

const repositoryUrl = (path: string) => new URL(`../../../${path}`, import.meta.url)
const readFileSync = (path: string, encoding: 'utf8') =>
  readFileSyncFromDisk(repositoryUrl(path), encoding)
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

const machineOwned = [
  'vouchington-tooling',
  'enabledMcpjsonServers',
  'agent-blackboard@agent-blackboard',
  'mcp__vouchington-tooling__',
]
const optionalText = (path: string) =>
  existsSync(repositoryUrl(path)) ? readFileSync(path, 'utf8') : ''

describe('vouchington-tooling MCP repository configuration', () => {
  it.each(['.mcp.json', '.claude/settings.json', '.codex/config.toml'])(
    'leaves machine-owned registration out of %s',
    (path) => {
      const text = optionalText(path)
      for (const key of machineOwned) expect(text).not.toContain(key)
    },
  )

  it('does not commit the machine-registered config files', () => {
    for (const path of ['.mcp.json', '.claude/settings.json', '.codex/config.toml']) {
      expect(existsSync(repositoryUrl(path))).toBe(false)
    }
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
    const settings = optionalText('.claude/settings.json')
    for (const key of ['sandbox', 'model', 'effortLevel', 'useAutoModeDuringPlan', 'defaultMode']) {
      expect(settings).not.toContain(`"${key}"`)
    }
    expect(optionalText('.codex/config.toml')).not.toMatch(
      /^(?:sandbox_mode|approval_policy|approvals_reviewer|model|model_reasoning_effort)\s*=|\[sandbox_workspace_write\]/mu,
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
    expect(packageJson.peerDependencies?.['agent-blackboard']).toBeDefined()
    expect(packageJson.peerDependenciesMeta?.['agent-blackboard']).toEqual({ optional: true })
  })
})
