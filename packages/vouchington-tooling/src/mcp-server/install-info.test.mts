import { describe, expect, it } from 'vitest'
import { callTool } from './dispatch.mts'
import { captureInstall, describeInstall, installSuffix } from './install-info.mts'
import { BLACKBOARD_ENV } from './fake-blackboard.test-helpers.mts'
import { runIsolatedGit } from './worktree.mts'

const install = { name: 'vouchington-tooling', version: '1.2.3', location: '/opt/pkg' }

describe('install info', () => {
  it('captures the package version and location', () => {
    const captured = captureInstall('4.5.6')
    expect(captured).toMatchObject({ name: 'vouchington-tooling', version: '4.5.6' })
    expect(captured.location).toMatch(/vouchington-tooling$/)
    expect(captureInstall().version).toMatch(/^\d+\.\d+\.\d+/)
    expect(describeInstall(install)).toBe('vouchington-tooling 1.2.3 (/opt/pkg)')
  })

  it('flags only missing files inside the install', () => {
    const moduleError = Object.assign(
      new Error("Cannot find module '/opt/pkg/bin/policy-runner.mjs'"),
      { code: 'ERR_MODULE_NOT_FOUND' },
    )
    expect(installSuffix(moduleError, install)).toContain('install changed underneath')
    expect(installSuffix(moduleError, install)).toContain('[vouchington-tooling 1.2.3 (/opt/pkg)]')
    const enoent = Object.assign(new Error('boom'), { code: 'ENOENT', path: '/opt/pkg/dist/x.mjs' })
    expect(installSuffix(enoent, install)).toContain('install changed underneath')
    const other = Object.assign(new Error("ENOENT: no such file '/elsewhere/x'"), {
      code: 'ENOENT',
      path: '/elsewhere/x',
    })
    expect(installSuffix(other, install)).not.toContain('underneath')
    expect(installSuffix('plain string', install)).not.toContain('underneath')
    expect(installSuffix(null, install)).not.toContain('underneath')
    expect(installSuffix(new Error('permission denied /opt/pkg/x'), install)).not.toContain(
      'underneath',
    )
  })

  it('appends the install to every tool error', async () => {
    const base = { launchRoot: undefined, env: BLACKBOARD_ENV, runGit: runIsolatedGit }
    const unknown = await callTool('nope', {}, { ...base, install })
    expect(unknown.isError).toBe(true)
    expect(unknown.content[0]?.text).toContain('[vouchington-tooling 1.2.3 (/opt/pkg)]')
    const fallback = await callTool('nope', {}, base)
    expect(fallback.content[0]?.text).toMatch(/\[vouchington-tooling \d+\.\d+\.\d+.*\]$/)
  })
})
