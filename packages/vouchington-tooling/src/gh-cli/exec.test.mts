import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ghSpawnEnv } from './env.mts'
import { createCommandRunner, runGh, runGit } from './exec.mts'
import type { ExecFileText } from './exec.mts'

describe('createCommandRunner', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns stdout from a successful invocation', async () => {
    const calls: Array<{ args: string[]; command: string }> = []
    const fakeExec: ExecFileText = async (command, args) => {
      calls.push({ args, command })
      return { stdout: 'hello\n' }
    }
    const run = createCommandRunner('fake-bin', fakeExec)
    await expect(run(['one', 'two'])).resolves.toBe('hello\n')
    expect(calls).toEqual([{ args: ['one', 'two'], command: 'fake-bin' }])
  })

  it('propagates a rejection from the underlying exec', async () => {
    const fakeExec: ExecFileText = async () => {
      throw new Error('boom')
    }
    const run = createCommandRunner('fake-bin', fakeExec)
    await expect(run(['x'])).rejects.toThrow('boom')
  })

  it('uses the real execFile-backed default when no exec is injected', async () => {
    // runGit is createCommandRunner('git') with the default exec parameter. `--version` is a
    // safe, universally available subcommand, so this covers the default-parameter path without
    // depending on any git repository state.
    await expect(runGit(['--version'])).resolves.toMatch(/git version/)
  })

  it('passes the parent env through unchanged by default', async () => {
    vi.stubEnv('CLICOLOR_FORCE', '1')
    vi.stubEnv('VOUCHINGTON_PASSTHROUGH', 'kept')
    const seen: Array<NodeJS.ProcessEnv | undefined> = []
    const run = createCommandRunner('fake-bin', async (_command, _args, options) => {
      seen.push(options?.env)
      return { stdout: '' }
    })
    await run([])
    expect(seen[0]).toMatchObject({ CLICOLOR_FORCE: '1', VOUCHINGTON_PASSTHROUGH: 'kept' })
  })

  it('spawns with the env returned by buildEnv', async () => {
    vi.stubEnv('CLICOLOR_FORCE', '1')
    vi.stubEnv('VOUCHINGTON_PASSTHROUGH', 'kept')
    const seen: Array<NodeJS.ProcessEnv | undefined> = []
    const run = createCommandRunner(
      'gh',
      async (_command, _args, options) => {
        seen.push(options?.env)
        return { stdout: '' }
      },
      ghSpawnEnv,
    )
    await run(['pr', 'view'])
    expect(seen[0]).not.toHaveProperty('CLICOLOR_FORCE')
    expect(seen[0]).toMatchObject({ VOUCHINGTON_PASSTHROUGH: 'kept' })
  })
})

describe('runGh', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('spawns a real gh without CLICOLOR_FORCE and keeps other variables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vouchington-gh-exec-'))
    try {
      writeFileSync(
        join(dir, 'gh'),
        '#!/bin/sh\nprintf "%s|%s" "${CLICOLOR_FORCE-unset}" "$VOUCHINGTON_PASSTHROUGH"\n',
      )
      chmodSync(join(dir, 'gh'), 0o755)
      vi.stubEnv('PATH', `${dir}${delimiter}${process.env.PATH ?? ''}`)
      vi.stubEnv('CLICOLOR_FORCE', '1')
      vi.stubEnv('VOUCHINGTON_PASSTHROUGH', 'kept')
      await expect(runGh([])).resolves.toBe('unset|kept')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
