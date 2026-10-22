import { describe, expect, it, vi } from 'vitest'

import {
  extractToolCommand,
  hookToolName,
  parseHookPayload,
  toolExitCode,
} from './hook-payload.mts'
import {
  renderPostToolReminder,
  type PaneTitleSpawn,
  type PaneTitleSpawnResult,
} from './reminder-post-tool.mts'

function titled(title: string): PaneTitleSpawn {
  return () => ({ status: 0, stdout: `${title}\n` })
}
const failing: PaneTitleSpawn = () => ({ status: 1, stdout: '', stderr: 'pane belongs elsewhere' })

function bash(command: string, extra: Record<string, unknown> = {}) {
  return { tool_name: 'Bash', tool_input: { command }, ...extra }
}

describe('renderPostToolReminder', () => {
  it('reminds after a plan is accepted', () => {
    const text = renderPostToolReminder(
      { tool_name: 'ExitPlanMode' },
      { spawnPaneTitle: titled('x'), env: {} },
    )
    expect(text).toContain('Plan accepted')
    expect(text).toContain('vouchington tmux name <name>')
  })

  it('names the configured rename command from options or TMUX_NAME_COMMAND', () => {
    const payload = bash('gh pr create --fill')
    expect(
      renderPostToolReminder(payload, { spawnPaneTitle: titled('x'), nameCommand: './rename' }),
    ).toContain('./rename <feature-pr123>')
    expect(
      renderPostToolReminder(payload, {
        spawnPaneTitle: titled('x'),
        env: { TMUX_NAME_COMMAND: 'my-name' },
      }),
    ).toContain('my-name <feature-pr123>')
  })

  it('reads the process environment by default', () => {
    vi.stubEnv('TMUX_NAME_COMMAND', 'from-process-env')
    const text = renderPostToolReminder(bash('gh pr create'), { spawnPaneTitle: titled('x') })
    vi.unstubAllEnvs()
    expect(text).toContain('from-process-env')
  })

  it.each([
    ['gh pr create --fill', 'PR created'],
    ['cd x && gh pr create', 'PR created'],
  ])('reminds for %s', (command, expected) => {
    expect(
      renderPostToolReminder(bash(command), { spawnPaneTitle: titled('topic'), env: {} }),
    ).toContain(expected)
  })

  it('reminds on push when the title lacks a -pr suffix and stays quiet when it has one', () => {
    const payload = bash('git push origin HEAD')
    expect(renderPostToolReminder(payload, { spawnPaneTitle: titled('topic'), env: {} })).toContain(
      'git push on PR branch',
    )
    expect(
      renderPostToolReminder(payload, { spawnPaneTitle: titled('topic-pr12'), env: {} }),
    ).toBeNull()
  })

  it('reminds after reset-worktree only when the title is not empty', () => {
    const payload = bash('./scripts/reset-worktree.sh --force')
    expect(renderPostToolReminder(payload, { spawnPaneTitle: titled('stale'), env: {} })).toContain(
      'reset-worktree ran',
    )
    expect(renderPostToolReminder(payload, { spawnPaneTitle: titled(''), env: {} })).toBeNull()
  })

  it('ignores reset-worktree --help but not a later real reset in the same command', () => {
    const options = { spawnPaneTitle: titled('stale'), env: {} }
    expect(renderPostToolReminder(bash('reset-worktree --help'), options)).toBeNull()
    expect(
      renderPostToolReminder(bash('reset-worktree -h; reset-worktree --force'), options),
    ).toContain('reset-worktree ran')
  })

  it('accepts the Shell tool name', () => {
    const payload = { tool_name: 'Shell', tool_input: { command: 'gh pr create' } }
    expect(renderPostToolReminder(payload, { spawnPaneTitle: titled('x'), env: {} })).toContain(
      'PR created',
    )
  })

  it('is silent for unrelated tools, empty commands, and failed commands', () => {
    const options = { spawnPaneTitle: titled('x'), env: {} }
    expect(renderPostToolReminder({ tool_name: 'Read' }, options)).toBeNull()
    expect(renderPostToolReminder({ tool_name: 'Bash' }, options)).toBeNull()
    expect(renderPostToolReminder(bash('ls'), options)).toBeNull()
    expect(
      renderPostToolReminder(bash('gh pr create', { tool_response: { exit_code: 1 } }), options),
    ).toBeNull()
    expect(
      renderPostToolReminder(bash('gh pr create', { tool_response: { exit_code: 0 } }), options),
    ).toContain('PR created')
  })

  it.each([
    [{ tool_name: 'ExitPlanMode' }],
    [bash('gh pr create')],
    [bash('git push')],
    [bash('reset-worktree')],
  ])('is silent without a verified pane for %j', (payload) => {
    expect(renderPostToolReminder(payload, { spawnPaneTitle: failing, env: {} })).toBeNull()
  })

  it('retries transient spawn errors and transient tmux stderr, then gives up', () => {
    const results: PaneTitleSpawnResult[] = [
      { status: null, stdout: '', error: Object.assign(new Error('busy'), { code: 'EBUSY' }) },
      { status: 1, stdout: '', stderr: 'Resource temporarily unavailable' },
      { status: 0, stdout: 'ok-pr1\n' },
    ]
    const spawn = vi.fn<PaneTitleSpawn>(() => results.shift()!)
    expect(renderPostToolReminder(bash('git push'), { spawnPaneTitle: spawn, env: {} })).toBeNull()
    expect(spawn).toHaveBeenCalledTimes(3)

    const always = vi.fn<PaneTitleSpawn>(() => ({ status: 1, stdout: '', stderr: 'EAGAIN' }))
    expect(renderPostToolReminder(bash('git push'), { spawnPaneTitle: always, env: {} })).toBeNull()
    expect(always).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-transient spawn error', () => {
    const spawn = vi.fn<PaneTitleSpawn>(() => ({
      status: null,
      stdout: '',
      error: Object.assign(new Error('nope'), { code: 'ENOENT' }),
    }))
    expect(renderPostToolReminder(bash('git push'), { spawnPaneTitle: spawn, env: {} })).toBeNull()
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('reads the title through the shipped script with the default spawn', () => {
    const text = renderPostToolReminder(bash('git push'), {
      env: {
        PATH: process.env.PATH,
        AGENT_TMUX_SOCKET: '/s',
        AGENT_TMUX_PANE: '%1',
        TMUX_TARGET_BIN: '/nonexistent/tmux',
      },
    })
    expect(text).toBeNull()
  })
})

describe('hook payload helpers', () => {
  it('reads tool names, commands and exit codes across payload shapes', () => {
    expect(hookToolName({ toolName: 'Bash' })).toBe('Bash')
    expect(hookToolName({ name: 'Shell' })).toBe('Shell')
    expect(hookToolName({})).toBe('')
    expect(extractToolCommand({ toolInput: { command: 'a' } })).toBe('a')
    expect(extractToolCommand({ tool_input: 'x', command: 'b' })).toBe('b')
    expect(extractToolCommand({})).toBe('')
    expect(toolExitCode({ toolResult: { exit_code: 2 } })).toBe(2)
    expect(toolExitCode({ toolResponse: { exit_code: 'x' } })).toBeUndefined()
  })

  it('parses payload JSON and treats anything else as empty', () => {
    expect(parseHookPayload('{"a":1}')).toEqual({ a: 1 })
    expect(parseHookPayload('[1]')).toEqual({})
    expect(parseHookPayload('not json')).toEqual({})
  })
})
