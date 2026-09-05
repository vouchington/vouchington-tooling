import { describe, expect, it } from 'vitest'

import { createCommandRunner, runGit } from './exec.mts'
import type { ExecFileText } from './exec.mts'

describe('createCommandRunner', () => {
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
})
