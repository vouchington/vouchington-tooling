import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FACTS_TIMEOUT_MS,
  composeFromArgs,
  sensitiveValues,
  worktreeExecutor,
} from './retrospective-input.mts'

let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'retrospective-input-'))
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

describe('worktreeExecutor', () => {
  it('returns stdout for a command that succeeds', async () => {
    const run = worktreeExecutor(directory, { PATH: process.env.PATH })
    expect(await run('git', ['--version'])).toMatchObject({ ok: true, exitCode: 0, stderr: '' })
  })

  it('reports the stderr and numeric exit code of a failing command', async () => {
    const run = worktreeExecutor(directory, {
      PATH: process.env.PATH,
      GIT_CEILING_DIRECTORIES: '/',
    })
    const result = await run('git', ['rev-parse', '--git-dir'])
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(128)
    expect(result.stderr).toContain('not a git repository')
  })

  it('falls back to the error message with no exit code when the command cannot start', async () => {
    const run = worktreeExecutor(directory, { PATH: directory })
    const result = await run('git', ['--version'])
    expect(result).toMatchObject({ ok: false, exitCode: null })
    expect(result.stderr).toContain('ENOENT')
  })

  it('bounds facts commands to 120 seconds by default', () => {
    expect(FACTS_TIMEOUT_MS).toBe(120_000)
  })

  it('kills a command that outlives the timeout and says so', async () => {
    const run = worktreeExecutor(directory, { PATH: process.env.PATH }, 100)
    const result = await run('node', ['-e', 'setInterval(() => {}, 1000)'])
    expect(result).toMatchObject({ ok: false, exitCode: null })
    expect(result.stderr).toContain('timed out after 100 ms')
  })

  it('kills a helper the command left running, and caps its output', async () => {
    const pidFile = join(directory, 'helper.pid')
    const script = `
      const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      child.unref()
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))
    `
    const run = worktreeExecutor(directory, { PATH: process.env.PATH })
    expect(await run('node', ['-e', script])).toMatchObject({ ok: true, exitCode: 0 })
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(/ESRCH/), { timeout: 5000 })
    const loud = await run('node', ['-e', 'process.stdout.write("x".repeat(10_000_001))'])
    expect(loud).toMatchObject({ ok: false, exitCode: null })
    expect(loud.stderr).toContain('node wrote more than 10000000 bytes')
  })

  it('never passes the blackboard credentials, NODE_OPTIONS, or GIT_* to the command', async () => {
    const run = worktreeExecutor(directory, {
      PATH: process.env.PATH,
      HOME: '/home/agent',
      AGENT_BLACKBOARD_URL: 'https://example.test',
      AGENT_BLACKBOARD_TOKEN: 'secret',
      NODE_OPTIONS: '--max-old-space-size=64',
      GIT_DIR: '/elsewhere',
    })
    const names = [
      'AGENT_BLACKBOARD_URL',
      'AGENT_BLACKBOARD_TOKEN',
      'NODE_OPTIONS',
      'GIT_DIR',
      'HOME',
    ]
    const script = `console.log(${JSON.stringify(names)}.map((n) => String(process.env[n])).join(','))`
    const result = await run('node', ['-e', script])
    expect(result.stdout.trim()).toBe('undefined,undefined,undefined,undefined,/home/agent')
  })
})

describe('sensitiveValues', () => {
  it('adds the server token to the caller values and validates them', () => {
    expect(sensitiveValues(undefined, {})).toEqual([])
    expect(
      sensitiveValues({ knownSensitiveValues: ['abcd'] }, { AGENT_BLACKBOARD_TOKEN: 'token' }),
    ).toEqual(['token', 'abcd'])
    // Deduplicated and longest first, so a caller's prefix of a credential cannot split it.
    expect(
      sensitiveValues(
        { knownSensitiveValues: ['abb_', 'ghub'] },
        { AGENT_BLACKBOARD_TOKEN: 'abb_sk_secret', GH_TOKEN: 'ghub', GITHUB_TOKEN: 'ghub-2' },
      ),
    ).toEqual(['abb_sk_secret', 'ghub-2', 'abb_', 'ghub'])
    // JSON-escaped forms are redacted too, since the composer escapes structured fields.
    expect(sensitiveValues({ knownSensitiveValues: ['a"b\\c'] }, {})).toEqual([
      'a\\"b\\\\c',
      'a"b\\c',
    ])
    expect(() => sensitiveValues({ knownSensitiveValues: ['abc'] }, {})).toThrow(
      'entries must be at least 4 characters',
    )
    expect(() => sensitiveValues({ knownSensitiveValues: 'a' }, {})).toThrow('array of strings')
    expect(() => sensitiveValues({ knownSensitiveValues: [1] }, {})).toThrow('array of strings')
  })
})

describe('composeFromArgs transcript', () => {
  const unassessed = { status: 'not-assessed', reason: 'not inspected' }
  const compose = (transcript: unknown) => ({
    narrative: 'n',
    date: '2026-01-01',
    issues: [],
    prs: [],
    description: 'd',
    facts: unassessed,
    transcript,
    tools: { status: 'none-observed', reason: 'nothing' },
    architecture: { status: 'none-observed', reason: 'nothing' },
  })
  const base = {
    sessionId: 'native:owner',
    repositories: ['o/r'],
    workOutcome: 'success' as const,
    feedbackCoverage: { status: 'complete' as const, sources: [], droppedCount: 0 },
    worktree: '/tmp',
    env: {},
    dependencies: {} as never,
  }

  it('rejects every path override and a foreign session id', async () => {
    for (const key of ['jsonlPath', 'projectsDir', 'codexSessionsDir', 'grokSessionsDir', 'cwd'])
      await expect(composeFromArgs(compose({ [key]: '/etc' }), base)).rejects.toThrow(
        `unsupported argument(s): ${key}`,
      )
    await expect(composeFromArgs(compose({ sessionId: 'other' }), base)).rejects.toThrow(
      'must equal the sessionId of the call',
    )
    await expect(
      composeFromArgs(compose({ ...unassessed, sessionId: 'native:owner' }), base),
    ).rejects.toThrow('exclusive')
    await expect(composeFromArgs(compose({ reason: 'not inspected' }), base)).rejects.toThrow(
      'compose.transcript.reason requires a status',
    )
    const own = { ...base, env: { CLAUDE_CODE_SESSION_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }
    await expect(
      composeFromArgs(compose({ harnessSessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), own),
    ).rejects.toThrow('may read only the harness session that launched the server')
  })

  it('treats facts as an exclusive union of unassessed status and live selectors', async () => {
    const withFacts = (facts: unknown) => ({ ...compose(unassessed), facts })
    await expect(composeFromArgs(withFacts({ reason: 'x' }), base)).rejects.toThrow(
      'compose.facts.reason requires a status',
    )
    await expect(
      composeFromArgs(withFacts({ ...unassessed, noPr: true, pr: '1' }), base),
    ).rejects.toThrow('compose.facts: status is exclusive with pr, noPr')
    for (const [facts, message] of [
      [{ noPr: 'false' }, 'compose.facts.noPr must be a boolean'],
      [{ pr: 1 }, 'compose.facts.pr must be a pull request number string'],
      [
        { pr: 'https://github.com/other/private/pull/1' },
        'compose.facts.pr must be a pull request number string',
      ],
      [{ branch: null }, 'compose.facts.branch must be a branch name'],
      [
        { branch: 'https://github.com/other/private/pull/123' },
        'compose.facts.branch must be a branch name',
      ],
      [{ branch: '--repo=x' }, 'compose.facts.branch must be a branch name'],
      [{ branch: 'a..b' }, 'compose.facts.branch must be a branch name'],
    ] as const)
      await expect(composeFromArgs(withFacts(facts), base)).rejects.toThrow(message)
    // Facts never query another repository with the server's GitHub token.
    await expect(
      composeFromArgs(withFacts({ repo: 'other/private', pr: '1' }), base),
    ).rejects.toThrow('unsupported argument(s): repo')
  })
})
