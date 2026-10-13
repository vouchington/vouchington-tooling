import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

  it('kills a process that writes too much', async () => {
    const result = await spawnPolicy(
      request('process.stdout.write("x".repeat(5000)); setInterval(() => {}, 1000)'),
    )
    expect(result.overflowed).toBe(true)
  })

  it('rejects when the command cannot start, and ignores a closed stdin', async () => {
    await expect(spawnPolicy(request('', { command: '/nonexistent/node' }))).rejects.toThrow()
    const result = await spawnPolicy(request('process.stdin.destroy()', { input: 'x'.repeat(1e6) }))
    expect(result.exitCode).toBe(0)
  })
})
