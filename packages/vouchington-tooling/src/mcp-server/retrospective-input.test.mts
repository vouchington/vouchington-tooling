import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { worktreeExecutor } from './retrospective-input.mts'

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

  it('never passes the blackboard credentials to the command', async () => {
    const run = worktreeExecutor(directory, {
      PATH: process.env.PATH,
      AGENT_BLACKBOARD_URL: 'https://example.test',
      AGENT_BLACKBOARD_TOKEN: 'secret',
    })
    const result = await run('node', ['-p', 'String(process.env.AGENT_BLACKBOARD_TOKEN)'])
    expect(result.stdout.trim()).toBe('undefined')
  })
})
