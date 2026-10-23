import { describe, expect, it } from 'vitest'

import { checkFile, postToolUseOutput } from '../index.mts'
import type { HookContext, HookPolicy, PostToolUseChecker } from '../index.mts'

const context = (overrides: Partial<HookContext> = {}): HookContext => ({
  harness: 'claude',
  payload: {},
  env: {},
  root: '/repo',
  ...overrides,
})

describe('post-tool-use', () => {
  const warns: PostToolUseChecker = {
    matches: (file, root) => file.endsWith('.md') && root === '/repo',
    check: (file) => [{ level: 'warn', message: `bad ${file}` }],
  }
  const throws: PostToolUseChecker = {
    matches: () => true,
    check: () => {
      throw new Error('boom')
    },
  }

  it('runs only matching checkers', () => {
    expect(checkFile('a.md', '/repo', [warns])).toEqual([{ level: 'warn', message: 'bad a.md' }])
    expect(checkFile('a.ts', '/repo', [warns])).toEqual([])
    expect(checkFile('a.ts', '/repo')).toEqual([])
  })

  it('turns a throwing checker into one error warning', () => {
    expect(checkFile('a', '/r', [throws])).toEqual([
      { level: 'error', message: 'Unexpected error in post-tool-use checks: boom' },
    ])
    const thrown = checkFile('a', '/r', [
      {
        matches: () => true,
        check: () => {
          throw 'plain'
        },
      },
    ])
    expect(thrown[0]?.message).toContain('plain')
  })

  it('checks only files that exist after an apply_patch', async () => {
    const seen: string[] = []
    const recorder: PostToolUseChecker = {
      matches: () => true,
      check: (file) => (seen.push(file), []),
    }
    const patch = [
      '*** Begin Patch',
      '*** Add File: added.md',
      '*** Delete File: gone.md',
      '*** Update File: old.md',
      '*** Move to: new.md',
      '*** Update File: kept.md',
      '*** End Patch',
    ].join('\n')
    const ctx = context({ payload: { tool_input: { command: patch } } })
    await postToolUseOutput(ctx, { checkers: [recorder] })
    expect(seen).toEqual(['added.md', 'new.md', 'kept.md'])
  })

  it('keeps going after a checker throws and checks every apply_patch path', async () => {
    const seen: string[] = []
    const recorder: PostToolUseChecker = {
      matches: () => true,
      check: (file) => (seen.push(file), []),
    }
    const patch = '*** Begin Patch\n*** Update File: a.md\n*** Add File: b.md\n*** End Patch'
    const ctx = context({ payload: { tool_input: { command: patch } } })
    const out = await postToolUseOutput(ctx, { checkers: [throws, recorder] })
    expect(seen).toEqual(['a.md', 'b.md'])
    expect(out.match(/Unexpected error in post-tool-use checks: boom/g)).toHaveLength(2)
  })

  it('emits one additionalContext JSON with warnings and the reminder', async () => {
    const ctx = context({ payload: { tool_input: { file_path: 'a.md' } } })
    const out = await postToolUseOutput(ctx, { checkers: [warns], reminder: () => 'remember' })
    expect(JSON.parse(out)).toEqual({
      hookSpecificOutput: {
        additionalContext: '[warn] bad a.md\nremember',
        hookEventName: 'PostToolUse',
      },
    })
    expect(out.endsWith('\n')).toBe(true)
  })

  it('is silent with nothing to say and swallows reminder failures', async () => {
    expect(await postToolUseOutput(context(), {})).toBe('')
    const ctx = context({ payload: { tool_input: { file_path: 'a.ts' } } })
    expect(await postToolUseOutput(ctx, { checkers: [warns], reminder: () => null })).toBe('')
    expect(await postToolUseOutput(ctx, { reminder: () => '' })).toBe('')
    const failing: HookPolicy = {
      reminder: () => {
        throw new Error('x')
      },
    }
    expect(await postToolUseOutput(ctx, failing)).toBe('')
    expect(await postToolUseOutput(ctx, { reminder: async () => 'async' })).toContain('async')
  })

  it('stays silent for Grok, which ignores passive-event stdout', async () => {
    const policy: HookPolicy = { checkers: [warns], reminder: () => 'remember' }
    const payload = { tool_input: { file_path: 'a.md' } }
    expect(await postToolUseOutput(context({ harness: 'grok', payload }), policy)).toBe('')
    expect(await postToolUseOutput(context({ payload }), policy)).toContain('additionalContext')
  })
})
