import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePolicyModule } from './policy-config.mts'
import { POLICY_TIMEOUTS_MS, runPolicyExport, runValidator } from './policy-run.mts'
import type { PolicyOutcome, PolicySpawner } from './policy-spawn.mts'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vouchington-policy-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function declare(policy: unknown, file?: string): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ 'vouchington-tooling': { policy } }))
  if (file !== undefined) writeFileSync(join(root, file), '')
}

const outcome = (overrides: Partial<PolicyOutcome> = {}): PolicyOutcome => ({
  exitCode: 0,
  stdout: JSON.stringify({ ok: true, result: { errors: [] } }),
  stderr: '',
  timedOut: false,
  overflowed: false,
  ...overrides,
})
const run = (
  spawn: PolicySpawner,
  name: keyof typeof POLICY_TIMEOUTS_MS = 'validateRetrospective',
) => runPolicyExport({ worktree: root, export: name, input: { a: 1 }, env: {}, spawn })

describe('resolvePolicyModule', () => {
  it('is undefined without a package.json, a declaration, or a policy key', async () => {
    await expect(resolvePolicyModule(root)).resolves.toBeUndefined()
    writeFileSync(join(root, 'package.json'), '{}')
    await expect(resolvePolicyModule(root)).resolves.toBeUndefined()
    writeFileSync(join(root, 'package.json'), 'null')
    await expect(resolvePolicyModule(root)).resolves.toBeUndefined()
  })

  it('resolves a relative path inside the worktree to its real path', async () => {
    mkdirSync(join(root, 'dev'))
    declare('dev/policy.mts', 'dev/policy.mts')
    await expect(resolvePolicyModule(root)).resolves.toMatch(/dev\/policy\.mts$/)
  })

  it('rejects absolute, escaping, symlinked-out, missing, and non-string paths', async () => {
    declare('/etc/passwd')
    await expect(resolvePolicyModule(root)).rejects.toThrow('must be relative')
    const outside = mkdtempSync(join(tmpdir(), 'vouchington-outside-'))
    writeFileSync(join(outside, 'x.mts'), '')
    declare('../x.mts')
    await expect(resolvePolicyModule(root)).rejects.toThrow('does not exist')
    symlinkSync(join(outside, 'x.mts'), join(root, 'link.mts'))
    declare('link.mts')
    await expect(resolvePolicyModule(root)).rejects.toThrow('stay inside the worktree')
    symlinkSync(outside, join(root, 'dir'))
    declare('dir/x.mts')
    await expect(resolvePolicyModule(root)).rejects.toThrow('stay inside the worktree')
    declare('missing.mts')
    await expect(resolvePolicyModule(root)).rejects.toThrow('does not exist')
    declare(7)
    await expect(resolvePolicyModule(root)).rejects.toThrow('non-empty string')
    rmSync(outside, { recursive: true, force: true })
  })

  it('rejects a malformed vouchington-tooling section instead of skipping the policy', async () => {
    for (const section of ['dev/agent-policy.mts', ['x'], null, 7]) {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ 'vouchington-tooling': section }))
      await expect(resolvePolicyModule(root)).rejects.toThrow('must be an object')
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ 'vouchington-tooling': {} }))
    await expect(resolvePolicyModule(root)).resolves.toBeUndefined()
  })

  it('rejects a package.json that is not JSON', async () => {
    writeFileSync(join(root, 'package.json'), '{')
    await expect(resolvePolicyModule(root)).rejects.toThrow('not valid JSON')
  })

  it('fails closed when package.json exists but cannot be read', async () => {
    mkdirSync(join(root, 'package.json'))
    await expect(resolvePolicyModule(root)).rejects.toThrow(/could not be read.*EISDIR/)
  })
})

describe('runPolicyExport', () => {
  it('reports no policy without spawning when none is declared', async () => {
    const spawn = vi.fn()
    await expect(run(spawn)).resolves.toEqual({ status: 'no-policy' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns node on the runner with a minimal environment and the request on stdin', async () => {
    declare('policy.mts', 'policy.mts')
    const spawn = vi.fn<PolicySpawner>().mockResolvedValue(outcome())
    const env = {
      HOME: '/home/x',
      GH_TOKEN: 'gh-token',
      AGENT_BLACKBOARD_TOKEN: 'secret',
      AGENT_BLACKBOARD_URL: 'u',
      NODE_OPTIONS: '--inspect',
    }
    await runPolicyExport({ worktree: root, export: 'validateRetrospective', input: 1, env, spawn })
    const request = spawn.mock.calls[0]![0]
    expect(request.command).toBe(process.execPath)
    expect(request.args[0]).toMatch(/bin\/policy-runner\.mjs$/)
    expect(request.cwd).toBe(root)
    expect(Object.keys(request.env).toSorted()).toEqual(['GH_TOKEN', 'HOME', 'PATH'])
    expect(request.env.PATH).toMatch(/^\/usr\/bin:\/bin:/)
    expect(JSON.parse(request.input)).toEqual({
      policyVersion: 1,
      export: 'validateRetrospective',
      input: 1,
    })
    expect(request.timeoutMs).toBe(30_000)
  })

  it('gives the pull request exports 120 seconds', () => {
    expect(POLICY_TIMEOUTS_MS).toEqual({
      validateRetrospective: 30_000,
      validatePullRequest: 120_000,
      pullRequestDefaults: 120_000,
    })
  })

  it('says explicitly that a killed run timed out, with its limit', async () => {
    declare('policy.mts', 'policy.mts')
    const killed = async () => outcome({ timedOut: true, exitCode: null })
    await expect(run(killed, 'validatePullRequest')).rejects.toThrow(
      'policy validatePullRequest timed out after 120s',
    )
    await expect(run(killed)).rejects.toThrow('policy validateRetrospective timed out after 30s')
  })

  it('fails, never passes, on overflow, a non-zero exit, bad JSON, and an unknown reply', async () => {
    declare('policy.mts', 'policy.mts')
    await expect(run(async () => outcome({ overflowed: true }))).rejects.toThrow('more than')
    await expect(run(async () => outcome({ exitCode: 3, stderr: 'boom' }))).rejects.toThrow(
      'exited with code 3: boom',
    )
    await expect(run(async () => outcome({ stdout: 'nope' }))).rejects.toThrow('not valid JSON')
    await expect(run(async () => outcome({ stdout: 'null' }))).rejects.toThrow('unrecognized')
    await expect(
      run(async () => outcome({ stdout: JSON.stringify({ ok: false, error: 'Error: bad' }) })),
    ).rejects.toThrow('failed: Error: bad')
  })

  it('scrubs server credentials from policy errors, stderr, and results', async () => {
    declare('policy.mts', 'policy.mts')
    const env = {
      GH_TOKEN: 'ghp_secretvalue',
      // A prefix of GH_TOKEN: longest-first redaction must not leave "[REDACTED]value".
      GITHUB_TOKEN: 'ghp_secret',
    }
    const withEnv = (stub: PolicyOutcome) =>
      runPolicyExport({
        worktree: root,
        export: 'validateRetrospective',
        input: 1,
        env,
        spawn: async () => stub,
      })
    const thrown = { ok: false, error: 'Error: leaked ghp_secretvalue' }
    await expect(withEnv(outcome({ stdout: JSON.stringify(thrown) }))).rejects.toThrow(
      'failed: Error: leaked [REDACTED]',
    )
    await expect(
      withEnv(outcome({ exitCode: 1, stderr: 'token=ghp_secretvalue' })),
    ).rejects.toThrow('exited with code 1: token=[REDACTED]')
    // A credential with JSON-special characters, printed JSON-escaped to stderr.
    await expect(
      runPolicyExport({
        worktree: root,
        export: 'validateRetrospective',
        input: 1,
        env: { GH_TOKEN: 'gh"p\\tok' },
        spawn: async () => outcome({ exitCode: 1, stderr: '{"token":"gh\\"p\\\\tok"}' }),
      }),
    ).rejects.toThrow('exited with code 1: {"token":"[REDACTED]"}')
    const result = { errors: ['bad ghp_secretvalue "quoted"'], warnings: ['ok'] }
    await expect(
      withEnv(outcome({ stdout: JSON.stringify({ ok: true, result }) })),
    ).resolves.toEqual({
      status: 'ok',
      result: { errors: ['bad [REDACTED] "quoted"'], warnings: ['ok'] },
    })
    await expect(
      runPolicyExport({
        worktree: root,
        export: 'validateRetrospective',
        input: 1,
        env: {},
        spawn: async () => outcome(),
      }),
    ).resolves.toEqual({ status: 'ok', result: { errors: [] } })
  })

  it('refuses to run, never spawning, when a credential is too short to redact', async () => {
    declare('policy.mts', 'policy.mts')
    const spawn = vi.fn<PolicySpawner>()
    for (const env of [{ AGENT_BLACKBOARD_TOKEN: 'abc' }, { GH_TOKEN: 'x', GITHUB_TOKEN: '' }])
      await expect(
        runPolicyExport({ worktree: root, export: 'validateRetrospective', input: 1, env, spawn }),
      ).rejects.toThrow('too short to redact: policy tools refuse to run')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('treats a missing export as skipped', async () => {
    declare('policy.mts', 'policy.mts')
    const skipped = outcome({ stdout: JSON.stringify({ ok: true, skipped: true }) })
    await expect(run(async () => skipped)).resolves.toEqual({ status: 'skipped' })
  })
})

describe('runValidator', () => {
  const reply =
    (result: unknown): PolicySpawner =>
    async () =>
      outcome({ stdout: JSON.stringify({ ok: true, result }) })
  const validate = (spawn: PolicySpawner) =>
    runValidator({ worktree: root, export: 'validateRetrospective', input: 1, env: {}, spawn })

  it('returns errors and warnings, defaulting warnings to none', async () => {
    declare('policy.mts', 'policy.mts')
    await expect(validate(reply({ errors: ['a'], warnings: ['w'] }))).resolves.toEqual({
      errors: ['a'],
      warnings: ['w'],
    })
    await expect(validate(reply({ errors: [] }))).resolves.toEqual({ errors: [], warnings: [] })
  })

  it('rejects a result that is not { errors: string[], warnings?: string[] }', async () => {
    declare('policy.mts', 'policy.mts')
    for (const bad of [null, {}, { errors: [1] }, { errors: [], warnings: 'x' }])
      await expect(validate(reply(bad))).rejects.toThrow('must return { errors: string[]')
  })

  it('passes no-policy through', async () => {
    await expect(validate(reply({}))).resolves.toEqual({ status: 'no-policy' })
  })
})
