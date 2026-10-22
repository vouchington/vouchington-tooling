import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  checkFile,
  defineHookPolicy,
  isAttendedClaudeSession,
  isAutomationContext,
  loadHookPolicy,
  normalizeCursorShellPayload,
  parseHookArgs,
  parseHookPayload,
  postToolUseOutput,
  preToolUseOutput,
  resolveHarness,
  runHook,
} from '../index.mts'
import type { HookContext, HookIo, HookPolicy, PostToolUseChecker } from '../index.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const context = (overrides: Partial<HookContext> = {}): HookContext => ({
  harness: 'claude',
  payload: {},
  env: {},
  root: '/repo',
  ...overrides,
})
const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } })

describe('parseHookArgs', () => {
  it('parses event, harness, policy, and root in either flag form', () => {
    expect(parseHookArgs(['pre-tool-use', '--harness', 'codex', '--policy', 'p.mjs'])).toEqual({
      event: 'pre-tool-use',
      harness: 'codex',
      policy: 'p.mjs',
    })
    expect(
      parseHookArgs(['post-tool-use', '--harness=grok', '--policy=p.mjs', '--root', '/r']),
    ).toEqual({ event: 'post-tool-use', harness: 'grok', policy: 'p.mjs', root: '/r' })
  })

  it.each([
    [[], 'unknown or missing hook event: (none)'],
    [['session-start'], 'unknown or missing hook event: session-start'],
    [['pre-tool-use', '--policy', 'p'], '--harness must be one of claude, codex, cursor, grok'],
    [['pre-tool-use', '--harness', 'vim', '--policy', 'p'], '--harness must be one of'],
    [['pre-tool-use', '--harness', 'claude'], '--policy <module> is required'],
    [['pre-tool-use', '--harness', 'claude', '--policy='], '--policy <module> is required'],
    [['pre-tool-use', '--harness', 'claude', '--policy'], '--policy needs a value'],
    [['pre-tool-use', '--bogus', 'x'], 'unknown argument: --bogus'],
    [['pre-tool-use', 'stray'], 'unknown argument: stray'],
  ])('rejects %j', (args, message) => {
    expect(() => parseHookArgs(args)).toThrow(message)
  })
})

describe('payload and harness detection', () => {
  it('parses stdin defensively', () => {
    expect(parseHookPayload('')).toEqual({})
    expect(parseHookPayload('  \n')).toEqual({})
    expect(parseHookPayload('{nope')).toEqual({})
    expect(parseHookPayload('[1]')).toEqual({})
    expect(parseHookPayload('null')).toEqual({})
    expect(parseHookPayload('{"a":1}')).toEqual({ a: 1 })
  })

  it('normalizes a Cursor Shell call to the Claude dialect', () => {
    const output = JSON.stringify({ exitCode: 3, output: 'out' })
    expect(normalizeCursorShellPayload({ tool_name: 'Shell', tool_output: output })).toEqual({
      tool_name: 'Bash',
      tool_output: output,
      tool_response: { exit_code: 3, stdout: 'out' },
    })
    expect(
      parseHookPayload(JSON.stringify({ tool_name: 'Shell', tool_output: { exitCode: 0 } }))
        .tool_response,
    ).toEqual({ exit_code: 0, stdout: '' })
  })

  it('keeps an existing tool_response and ignores unreadable output', () => {
    const kept = normalizeCursorShellPayload({
      tool_name: 'Shell',
      tool_output: '{"exitCode":1}',
      tool_response: 'mine',
    })
    expect(kept).toMatchObject({ tool_name: 'Bash', tool_response: 'mine' })
    for (const tool_output of ['not json', '{"exitCode":"1"}', 5, undefined, '[]']) {
      expect(normalizeCursorShellPayload({ tool_name: 'Shell', tool_output })).toEqual({
        tool_name: 'Bash',
        tool_output,
      })
    }
    const other = { tool_name: 'Bash' }
    expect(normalizeCursorShellPayload(other)).toBe(other)
  })

  it('lets Grok and Cursor markers override the declared harness', () => {
    expect(resolveHarness('claude', { GROK_SESSION_ID: 's' }, {})).toBe('grok')
    expect(resolveHarness('codex', { GROK_HOOK_EVENT: 'e' }, {})).toBe('grok')
    expect(resolveHarness('claude', { GROK_AGENT: '1' }, {})).toBe('claude')
    expect(resolveHarness('claude', {}, { cursor_version: '1.0' })).toBe('cursor')
    expect(resolveHarness('claude', { CURSOR_VERSION: '1' }, {})).toBe('cursor')
    expect(resolveHarness('claude', { CURSOR_PROJECT_DIR: '/p' }, {})).toBe('cursor')
    expect(resolveHarness('codex', { CURSOR_VERSION: '1' }, {})).toBe('codex')
    expect(resolveHarness('claude', {}, { cursor_version: 3 })).toBe('claude')
    expect(resolveHarness('cursor', {}, {})).toBe('cursor')
  })

  it('reads automation and attended markers strictly', () => {
    expect(isAutomationContext({ GITHUB_ACTIONS: 'true' })).toBe(true)
    expect(isAutomationContext({ CI: 'true' })).toBe(true)
    expect(isAutomationContext({ CI: '1' })).toBe(false)
    expect(isAutomationContext({})).toBe(false)
    expect(isAttendedClaudeSession({ CLAUDE_CODE_SESSION_ATTENDED: '1' })).toBe(true)
    expect(isAttendedClaudeSession({ CLAUDE_CODE_SESSION_ATTENDED: '0' })).toBe(false)
    expect(isAttendedClaudeSession({})).toBe(false)
  })
})

describe('preToolUseOutput', () => {
  const policy = {
    gitPatterns: [{ pattern: /\bgit\s+push\s+--force\b/, reason: 'no force' }],
    mergeGuidance: 'See merge.md.',
  }

  it('is silent when the policy has no opinion', () => {
    expect(preToolUseOutput(bash('ls'), policy)).toEqual({ exitCode: 0, stderr: '', stdout: '' })
  })

  it('exits 2 with the reason on stderr and a deny JSON on stdout', () => {
    expect(
      preToolUseOutput(bash('git push --force'), policy, { automationContext: false }),
    ).toEqual({
      exitCode: 2,
      stderr: 'no force\n',
      stdout: JSON.stringify({ decision: 'deny', reason: 'no force' }),
    })
  })

  it('blocks a merge in automation and defaults to automation', () => {
    expect(preToolUseOutput(bash('gh pr merge 1'), policy).exitCode).toBe(2)
    expect(
      preToolUseOutput(bash('gh pr merge 1'), policy, { automationContext: true }).stderr,
    ).toContain('See merge.md.')
  })

  it('allows an interactive merge silently only for an attended Claude session', () => {
    const merge = bash('gh pr merge 1')
    const interactive = { automationContext: false }
    const allowed = preToolUseOutput(merge, policy, {
      ...interactive,
      harness: 'claude',
      attended: true,
    })
    expect(allowed.exitCode).toBe(0)
    expect(JSON.parse(allowed.stdout).hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: expect.stringContaining('See merge.md.'),
    })
    const plain = preToolUseOutput(merge, {}, { ...interactive, harness: 'claude', attended: true })
    expect(JSON.parse(plain.stdout).hookSpecificOutput.permissionDecisionReason).toMatch(
      /this session\.$/,
    )
    for (const options of [
      { harness: 'claude' as const, attended: false },
      { harness: 'codex' as const, attended: true },
      { harness: 'cursor' as const, attended: true },
      { attended: true },
      {},
    ]) {
      expect(preToolUseOutput(merge, policy, { ...interactive, ...options })).toEqual({
        exitCode: 0,
        stderr: '',
        stdout: '',
      })
    }
  })

  it('passes an explicit cwd through', () => {
    const stack = { stack: { git: { isAncestor: () => false } as never } }
    expect(
      preToolUseOutput(bash('gh stack init t'), stack, { automationContext: false, cwd: '/x' })
        .exitCode,
    ).toBe(2)
  })
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
})

describe('loadHookPolicy and runHook', () => {
  function module(source: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'hook-policy-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'policy.mjs'), source)
    return dir
  }

  function io(root: string, stdin: string, env: NodeJS.ProcessEnv = {}) {
    const out: string[] = []
    const err: string[] = []
    const harness: HookIo = {
      readStdin: async () => stdin,
      stdout: { write: (text) => out.push(text) },
      stderr: { write: (text) => err.push(text) },
      env,
      cwd: root,
    }
    return { harness, out, err }
  }

  const forcePolicy = `export default {
    command: { gitPatterns: [{ pattern: /push --force/, reason: 'no force' }] },
    reminder: () => 'hello',
  }`

  it('loads an object, a function, a named export, and rejects anything else', async () => {
    const root = module(forcePolicy)
    expect(await loadHookPolicy('policy.mjs', context({ root }))).toHaveProperty('command')
    const fnRoot = module('export default (ctx) => ({ reminder: () => ctx.harness })')
    const fn = await loadHookPolicy('policy.mjs', context({ root: fnRoot }))
    expect(await fn.reminder?.(context())).toBe('claude')
    const named = module('export const policy = { checkers: [] }')
    expect(await loadHookPolicy(join(named, 'policy.mjs'), context())).toEqual({ checkers: [] })
    for (const body of ['export default 5', 'export default [1]', 'export const x = 1']) {
      const bad = module(body)
      await expect(loadHookPolicy('policy.mjs', context({ root: bad }))).rejects.toThrow(
        'must default-export a policy object',
      )
    }
  })

  it('blocks through pre-tool-use with exit 2', async () => {
    const root = module(forcePolicy)
    const run = io(root, JSON.stringify(bash('git push --force')))
    const code = await runHook(
      ['pre-tool-use', '--harness', 'claude', '--policy', 'policy.mjs'],
      run.harness,
    )
    expect(code).toBe(2)
    expect(run.err).toEqual(['no force\n'])
    expect(JSON.parse(run.out[0]!)).toEqual({ decision: 'deny', reason: 'no force' })
  })

  it('allows silently and resolves --root against the working directory', async () => {
    const root = module(forcePolicy)
    const run = io(tmpdir(), JSON.stringify(bash('ls')))
    const code = await runHook(
      ['pre-tool-use', '--harness', 'codex', '--policy', 'policy.mjs', '--root', root],
      run.harness,
    )
    expect(code).toBe(0)
    expect([run.out, run.err]).toEqual([[], []])
  })

  it('writes the confirm allow only for an attended Claude session and runs onPayload first', async () => {
    const root = module(`export default {
      onPayload: ctx => { globalThis.__hookSeen = ctx.harness },
    }`)
    const attended = { CLAUDE_CODE_SESSION_ATTENDED: '1' }
    const run = io(root, JSON.stringify(bash('gh pr merge 4')), attended)
    const args = ['pre-tool-use', '--harness', 'claude', '--policy', 'policy.mjs']
    expect(await runHook(args, run.harness)).toBe(0)
    expect(JSON.parse(run.out[0]!).hookSpecificOutput.permissionDecision).toBe('allow')
    expect((globalThis as { __hookSeen?: string }).__hookSeen).toBe('claude')
    const ci = io(root, JSON.stringify(bash('gh pr merge 4')), { ...attended, CI: 'true' })
    expect(await runHook(args, ci.harness)).toBe(2)
  })

  it('fails pre-tool-use closed and post-tool-use open when the policy cannot load', async () => {
    const root = module('throw new Error("bad policy")')
    const pre = io(root, '{}')
    expect(
      await runHook(['pre-tool-use', '--harness', 'claude', '--policy', 'policy.mjs'], pre.harness),
    ).toBe(2)
    expect(pre.err.join('')).toContain('vouchington hook pre-tool-use: bad policy')
    const post = io(root, '{}')
    expect(
      await runHook(
        ['post-tool-use', '--harness', 'claude', '--policy', 'policy.mjs'],
        post.harness,
      ),
    ).toBe(0)
    expect(post.err.join('')).toContain('vouchington hook post-tool-use: bad policy')
    const missing = io(root, '{}')
    expect(
      await runHook(
        ['pre-tool-use', '--harness', 'claude', '--policy', 'nope.mjs'],
        missing.harness,
      ),
    ).toBe(2)
  })

  it('reports a non-Error failure and bad arguments', async () => {
    const root = module('throw "plain"')
    const run = io(root, '{}')
    await runHook(['post-tool-use', '--harness', 'claude', '--policy', 'policy.mjs'], run.harness)
    expect(run.err.join('')).toContain('plain')
    const bad = io(root, '{}')
    expect(await runHook(['pre-tool-use'], bad.harness)).toBe(2)
    expect(bad.err.join('')).toContain('usage: vouchington hook')
  })

  it('emits post-tool-use context from the policy', async () => {
    const root = module(forcePolicy)
    const run = io(root, JSON.stringify({ tool_input: { file_path: 'a.md' } }))
    expect(
      await runHook(
        ['post-tool-use', '--harness', 'cursor', '--policy', 'policy.mjs'],
        run.harness,
      ),
    ).toBe(0)
    expect(JSON.parse(run.out[0]!).hookSpecificOutput.additionalContext).toBe('hello')
  })

  it('types policy modules through defineHookPolicy', () => {
    const policy = defineHookPolicy({ checkers: [] })
    expect(policy).toEqual({ checkers: [] })
  })
})
