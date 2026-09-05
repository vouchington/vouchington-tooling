import { describe, expect, it } from 'vitest'

import { getDiffAgainstBase } from './diff.mts'
import type { RunTextCommand } from './exec.mts'

describe('getDiffAgainstBase', () => {
  it('runs git diff against the given base and returns its stdout', async () => {
    const calls: string[][] = []
    const runGit: RunTextCommand = async (args) => {
      calls.push(args)
      return 'diff --git a/x b/x\n'
    }
    await expect(getDiffAgainstBase(runGit, 'origin/main')).resolves.toBe('diff --git a/x b/x\n')
    expect(calls).toEqual([['diff', 'origin/main...HEAD']])
  })

  it('parameterizes the base ref rather than hardcoding one', async () => {
    const calls: string[][] = []
    const runGit: RunTextCommand = async (args) => {
      calls.push(args)
      return ''
    }
    await getDiffAgainstBase(runGit, 'upstream/develop')
    expect(calls).toEqual([['diff', 'upstream/develop...HEAD']])
  })
})
