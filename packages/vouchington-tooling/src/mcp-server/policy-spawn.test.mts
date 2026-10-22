import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRepoFixture, type RepoFixture } from './git-fixture.test-helpers.mts'
import { runPolicyExport, runValidator } from './policy-run.mts'
import { policyEnvironment, spawnPolicy } from './policy-spawn.mts'

const POLICY = `export function validateRetrospective(input: { markdown: string }) {
  console.log('noise on stdout')
  process.stdout.write('direct noise on stdout')
  return {
    errors: input.markdown.includes('bad') ? ['contains bad'] : [],
    warnings: [process.cwd(), String(process.env.AGENT_BLACKBOARD_TOKEN), String(process.env.NODE_OPTIONS)],
  }
}
export function pullRequestDefaults() { throw new Error('exploded') }
export async function validatePullRequest() { return 'not a report' }
`

let fixture: RepoFixture
beforeAll(() => {
  fixture = createRepoFixture()
  mkdirSync(join(fixture.main, 'dev'))
  writeFileSync(
    join(fixture.main, 'package.json'),
    JSON.stringify({ 'vouchington-tooling': { policy: 'dev/agent-policy.mts' } }),
  )
  writeFileSync(join(fixture.main, 'dev', 'agent-policy.mts'), POLICY)
})
afterAll(() => fixture.cleanup())

const base = () => ({ worktree: fixture.main, input: { markdown: 'fine' }, env: {} })

describe('policy child process', () => {
  it('runs the export in a fresh process in the worktree without credentials', async () => {
    const env = { AGENT_BLACKBOARD_TOKEN: 'secret', NODE_OPTIONS: '--max-old-space-size=64' }
    const report = await runValidator({ ...base(), export: 'validateRetrospective', env })
    expect(report).toEqual({ errors: [], warnings: [fixture.main, 'undefined', 'undefined'] })
    const rejected = await runValidator({
      ...base(),
      input: { markdown: 'bad' },
      export: 'validateRetrospective',
    })
    expect(rejected).toMatchObject({ errors: ['contains bad'] })
  })

  it('reports a thrown export and a malformed result as failures', async () => {
    await expect(runPolicyExport({ ...base(), export: 'pullRequestDefaults' })).rejects.toThrow(
      'policy pullRequestDefaults failed: Error: exploded',
    )
    await expect(runValidator({ ...base(), export: 'validatePullRequest' })).rejects.toThrow(
      'must return',
    )
  })

  it('skips a module that lacks the export', async () => {
    writeFileSync(join(fixture.linked, 'p.mts'), 'export const x = 1')
    writeFileSync(
      join(fixture.linked, 'package.json'),
      JSON.stringify({ 'vouchington-tooling': { policy: 'p.mts' } }),
    )
    await expect(
      runPolicyExport({ ...base(), worktree: fixture.linked, export: 'validateRetrospective' }),
    ).resolves.toEqual({ status: 'skipped' })
  })

  it('fails when the module cannot be imported', async () => {
    writeFileSync(join(fixture.linked, 'p.mts'), 'export const x = (')
    await expect(
      runPolicyExport({ ...base(), worktree: fixture.linked, export: 'validateRetrospective' }),
    ).rejects.toThrow(/policy validateRetrospective failed/)
  })
})

describe('policyEnvironment', () => {
  it('passes HOME and GitHub tokens only when present', () => {
    expect(Object.keys(policyEnvironment({})).toSorted()).toEqual(['PATH'])
    expect(
      Object.keys(policyEnvironment({ HOME: '/h', GITHUB_TOKEN: 't', GH_TOKEN: 't' })).toSorted(),
    ).toEqual(['GH_TOKEN', 'GITHUB_TOKEN', 'HOME', 'PATH'])
  })

  it('puts the system directories, node, and the first gh directory on PATH, deduplicated', () => {
    const first = join(fixture.root, 'first-bin')
    const second = join(fixture.root, 'second-bin')
    for (const directory of [first, second]) {
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'gh'), '#!/bin/sh\n')
      chmodSync(join(directory, 'gh'), 0o755)
    }
    const path = (serverPath?: string) =>
      policyEnvironment(serverPath === undefined ? {} : { PATH: serverPath }).PATH
    const base = [
      '/usr/bin',
      '/bin',
      '/usr/local/bin',
      '/opt/homebrew/bin',
      dirname(process.execPath),
    ]
    expect(path([second, first].join(delimiter))).toBe([...base, second].join(delimiter))
    expect(path(['', fixture.root, first].join(delimiter))).toBe([...base, first].join(delimiter))
    expect(path(['/usr/bin', '/bin'].join(delimiter))).toBe(base.join(delimiter))
    expect(path(fixture.root)).toBe(base.join(delimiter))
    expect(path()).toBe(base.join(delimiter))
  })
})

describe('spawnPolicy', () => {
  const request = (script: string, overrides = {}) => ({
    command: process.execPath,
    args: ['-e', script],
    cwd: fixture.root,
    env: {},
    input: '',
    timeoutMs: 10_000,
    maxOutputBytes: 1000,
    ...overrides,
  })

  it('kills a process that outlives its timeout', async () => {
    const result = await spawnPolicy(request('setInterval(() => {}, 1000)', { timeoutMs: 100 }))
    expect(result).toMatchObject({ timedOut: true, exitCode: null })
  })

  it('kills the whole process group, including a grandchild, on timeout', async () => {
    const pidFile = join(fixture.root, 'grandchild.pid')
    const script = `
      const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))
      setInterval(() => {}, 1000)
    `
    const result = await spawnPolicy(request(script, { timeoutMs: 1500 }))
    expect(result.timedOut).toBe(true)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(/ESRCH/), { timeout: 5000 })
  })

  it('kills a grandchild the policy left running after a normal exit', async () => {
    const pidFile = join(fixture.root, 'orphan.pid')
    const script = `
      const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      child.unref()
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))
    `
    const result = await spawnPolicy(request(script))
    expect(result).toMatchObject({ exitCode: 0, timedOut: false })
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(/ESRCH/), { timeout: 5000 })
  })

  it('reaps a grandchild holding the inherited pipes as soon as the runner exits', async () => {
    const script = `
      const { spawn } = require('node:child_process')
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }).unref()
      process.stdout.write('done')
      process.exit(0)
    `
    const started = Date.now()
    const result = await spawnPolicy(request(script, { timeoutMs: 5000 }))
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, stdout: 'done' })
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('kills a process that writes too much', async () => {
    const result = await spawnPolicy(
      request('process.stdout.write("x".repeat(5000)); setInterval(() => {}, 1000)'),
    )
    expect(result.overflowed).toBe(true)
  })

  it('rejects when the command cannot start, and ignores a closed stdin', async () => {
    await expect(spawnPolicy(request('', { command: '/nonexistent/git' }))).rejects.toThrow(
      /ENOENT/,
    )
    const realExecPath = process.execPath
    Object.defineProperty(process, 'execPath', { value: '/nonexistent/node', configurable: true })
    try {
      await expect(spawnPolicy(request('', { command: '/nonexistent/node' }))).rejects.toThrow(
        /Node binary \(\/nonexistent\/node\) was removed.*restart Codex/,
      )
    } finally {
      Object.defineProperty(process, 'execPath', { value: realExecPath, configurable: true })
    }
    await expect(
      spawnPolicy(request('', { cwd: join(fixture.root, 'no-such-dir') })),
    ).rejects.toThrow(/ENOENT/)
    const result = await spawnPolicy(request('process.stdin.destroy()', { input: 'x'.repeat(1e6) }))
    expect(result.exitCode).toBe(0)
  })
})
