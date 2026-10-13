import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
      sensitiveValues({ knownSensitiveValues: ['a'] }, { AGENT_BLACKBOARD_TOKEN: 'tok' }),
    ).toEqual(['a', 'tok'])
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
  })
})
