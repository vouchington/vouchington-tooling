import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callTool } from './dispatch.mts'
import { captureInstall, describeInstall, installSuffix } from './install-info.mts'
import { BLACKBOARD_ENV } from './fake-blackboard.test-helpers.mts'
import { runIsolatedGit } from './worktree.mts'

const present = () => true
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
    expect(installSuffix(moduleError, install, present)).toContain('install changed underneath')
    expect(installSuffix(moduleError, install, present)).toContain(
      '[vouchington-tooling 1.2.3 (/opt/pkg)]',
    )
    const enoent = Object.assign(new Error('boom'), { code: 'ENOENT', path: '/opt/pkg/dist/x.mjs' })
    expect(installSuffix(enoent, install, present)).toContain('install changed underneath')
    const other = Object.assign(new Error("ENOENT: no such file '/elsewhere/x'"), {
      code: 'ENOENT',
      path: '/elsewhere/x',
    })
    expect(installSuffix(other, install, present)).not.toContain('underneath')
    const importer = Object.assign(
      new Error("Cannot find package 'dep' imported from /opt/pkg/dist/handler.mjs"),
      { code: 'ERR_MODULE_NOT_FOUND' },
    )
    expect(installSuffix(importer, install, present)).not.toContain('underneath')
    const outsideTarget = Object.assign(
      new Error("Cannot find module '/elsewhere/x.mjs' imported from /opt/pkg/dist/handler.mjs"),
      { code: 'ERR_MODULE_NOT_FOUND' },
    )
    expect(installSuffix(outsideTarget, install, present)).not.toContain('underneath')
    const insideTarget = Object.assign(
      new Error("Cannot find module '/opt/pkg/dist/x.mjs' imported from /elsewhere/y.mjs"),
      { code: 'ERR_MODULE_NOT_FOUND' },
    )
    expect(installSuffix(insideTarget, install, present)).toContain('underneath')
    const sibling = Object.assign(new Error("Cannot find module '/opt/pkg-other/x.mjs'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    })
    expect(installSuffix(sibling, install, present)).not.toContain('underneath')
    const root = Object.assign(new Error('x'), { code: 'ENOENT', path: '/opt/pkg' })
    expect(installSuffix(root, install, present)).not.toContain('underneath')
    expect(installSuffix('plain string', install, present)).not.toContain('underneath')
    expect(installSuffix(null, install, present)).not.toContain('underneath')
    expect(
      installSuffix(new Error('permission denied /opt/pkg/x'), install, present),
    ).not.toContain('underneath')
  })

  it('appends the install to every tool error', async () => {
    const base = { launchRoot: undefined, env: BLACKBOARD_ENV, runGit: runIsolatedGit }
    const unknown = await callTool('nope', {}, { ...base, install })
    expect(unknown.isError).toBe(true)
    expect(unknown.content[0]?.text).toContain('[vouchington-tooling 1.2.3 (/opt/pkg)]')
    const fallback = await callTool('nope', {}, base)
    expect(fallback.content[0]?.text).toMatch(/\[vouchington-tooling \d+\.\d+\.\d+.*\]$/)
  })

  it('names the install directory and the reconnect step once it is removed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-evicted-'))
    const real = { ...install, location: dir }
    const bare = Object.assign(new Error("Cannot find package 'agent-blackboard'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    })
    expect(installSuffix(bare, real)).not.toContain('removed')
    rmSync(dir, { recursive: true })
    const suffix = installSuffix(bare, real)
    expect(suffix).toContain(`install directory (${dir}) was removed`)
    expect(suffix).toContain('`/mcp` in Claude Code, or restart Codex')
    const swapped = Object.assign(new Error('x'), { code: 'ENOENT', path: join(dir, 'a.mjs') })
    expect(installSuffix(swapped, real).match(/reconnect/g)).toHaveLength(1)
    const result = await callTool(
      'nope',
      {},
      {
        launchRoot: undefined,
        env: BLACKBOARD_ENV,
        runGit: runIsolatedGit,
        install: real,
      },
    )
    expect(result.content[0]?.text).toContain('was removed')
  })
})
