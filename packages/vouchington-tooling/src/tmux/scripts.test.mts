import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const scripts = fileURLToPath(new URL('../../scripts/tmux/', import.meta.url))
// Answers only the pane queries and renames the scripts make; logs every call.
const fakeTmuxSource = `#!/usr/bin/env bash
if [ -n "\${FAKE_TMUX_LOG:-}" ]; then printf '%s\\n' "$*" >> "$FAKE_TMUX_LOG"; fi
if [ "\${1:-}" != -S ] || [ -z "\${2:-}" ]; then exit 1; fi
shift 2
case \${1:-} in
  display-message)
    if [ "\${FAKE_TMUX_PANE_MISSING:-}" = 1 ]; then exit 1; fi
    case \${5:-} in
      '#{pane_current_path}') printf '%s\\n' "\${FAKE_TMUX_PANE_PATH:-}" ;;
      '#{pane_title}') printf '%s\\n' "\${FAKE_TMUX_TITLE:-}" ;;
      *) exit 1 ;;
    esac ;;
  rename-window|select-pane|set-window-option) exit 0 ;;
  *) exit 1 ;;
esac
`
let fakeTmux: string

let dir: string
let worktree: string
let log: string

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'tmux-scripts-')))
  worktree = join(dir, 'work')
  mkdirSync(worktree)
  spawnSync('git', ['init', '-q'], { cwd: worktree })
  fakeTmux = join(dir, 'fake-tmux')
  writeFileSync(fakeTmux, fakeTmuxSource, { mode: 0o755 })
  log = join(dir, 'commands.log')
  writeFileSync(log, '')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function run(
  script: string,
  args: string[],
  env: Record<string, string | undefined> = {},
  input = '',
) {
  const result = spawnSync('bash', [join(scripts, script), ...args], {
    cwd: worktree,
    encoding: 'utf8',
    input,
    timeout: 10_000,
    env: {
      ...process.env,
      TMUX: undefined,
      TMUX_PANE: undefined,
      TMUX_NAME_COMMAND: undefined,
      TMUX_TARGET_ROOT: undefined,
      AGENT_TMUX_SOCKET: join(dir, 'tmux.sock'),
      AGENT_TMUX_PANE: '%1',
      AGENT_TMUX_WORKTREE: worktree,
      TMUX_TARGET_BIN: fakeTmux,
      FAKE_TMUX_PANE_PATH: worktree,
      FAKE_TMUX_LOG: log,
      ...env,
    },
  })
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    log: readFileSync(log, 'utf8'),
  }
}

const socket = () => join(dir, 'tmux.sock')

describe('tmux-name.sh', () => {
  it('renames the verified pane window and title', () => {
    const result = run('tmux-name.sh', ['agent-workflow'])
    expect(result.status).toBe(0)
    expect(result.log).toContain(`-S ${socket()} rename-window -t %1 -- agent-workflow`)
    expect(result.log).toContain(`-S ${socket()} select-pane -t %1 -T agent-workflow`)
  })

  it('restores automatic naming for an empty name', () => {
    const result = run('tmux-name.sh', [''])
    expect(result.status).toBe(0)
    expect(result.log).toContain('set-window-option -t %1 automatic-rename on')
    expect(result.log).not.toContain('rename-window')
  })

  it('prints usage', () => {
    expect(run('tmux-name.sh', ['--help']).stdout).toContain('Usage: vouchington tmux name')
  })

  it('accepts a complete CLI binding over a bad ambient binding', () => {
    const cliSocket = join(dir, 'cli.sock')
    const result = run(
      'tmux-name.sh',
      ['--socket', cliSocket, '--pane', '%7', '--worktree', worktree, 'cli-name'],
      {
        AGENT_TMUX_SOCKET: '/bad/ambient.sock',
        AGENT_TMUX_PANE: undefined,
      },
    )
    expect(result.status).toBe(0)
    expect(result.log).toContain(`-S ${cliSocket} rename-window -t %7 -- cli-name`)
  })

  it('uses TMUX_TARGET_ROOT instead of the current directory', () => {
    const other = join(dir, 'other')
    mkdirSync(other)
    const result = run('tmux-name.sh', ['topic'], { TMUX_TARGET_ROOT: other })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('binding belongs to a different worktree')
  })

  it('accepts a pane and binding in subdirectories of the same git worktree', () => {
    const sub = join(worktree, 'sub')
    mkdirSync(sub)
    const result = run('tmux-name.sh', ['topic'], {
      AGENT_TMUX_WORKTREE: sub,
      FAKE_TMUX_PANE_PATH: sub,
    })
    expect(result.status).toBe(0)
  })

  it('is a silent no-op outside tmux', () => {
    const result = run('tmux-name.sh', ['topic'], {
      AGENT_TMUX_SOCKET: undefined,
      AGENT_TMUX_PANE: undefined,
      AGENT_TMUX_WORKTREE: undefined,
    })
    expect(result).toMatchObject({ status: 0, stdout: '', stderr: '', log: '' })
  })

  it.each([
    [{ AGENT_TMUX_WORKTREE: undefined }, 'incomplete explicit binding'],
    [{ FAKE_TMUX_PANE_PATH: tmpdir() }, 'pane belongs to a different worktree'],
    [{ AGENT_TMUX_SOCKET: 'relative.sock' }, 'socket must be an absolute path'],
    [{ AGENT_TMUX_PANE: 'one' }, 'pane must be a literal %ID'],
    [{ FAKE_TMUX_PANE_MISSING: '1' }, 'pane is missing or unavailable'],
    [{ FAKE_TMUX_PANE_PATH: '' }, 'pane has no working directory'],
    [{ TMUX_TARGET_BIN: 'definitely-not-installed-tmux' }, 'tmux is missing'],
    [
      {
        AGENT_TMUX_SOCKET: undefined,
        AGENT_TMUX_PANE: undefined,
        AGENT_TMUX_WORKTREE: undefined,
        TMUX: '/s,1,0',
        TMUX_PANE: '%1',
      },
      'no verified controlling terminal',
    ],
  ])('refuses %j without touching tmux', (env, message) => {
    const result = run('tmux-name.sh', ['topic'], env)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
    expect(result.log).not.toContain('rename-window')
  })

  it.each([
    [['--socket'], 'missing value for --socket'],
    [['--pane', ''], 'missing value for --pane'],
    [['--socket', '/a', '--socket', '/b', 'n'], 'duplicate --socket'],
    [['--pane', '%1', '--pane', '%2', 'n'], 'duplicate --pane'],
    [['--worktree', '/a', '--worktree', '/b', 'n'], 'duplicate --worktree'],
    [['--bogus', 'n'], 'unknown option: --bogus'],
    [['a', 'b'], 'provide exactly one name'],
    [['--', 'a', 'b'], 'provide exactly one name'],
    [[], 'provide exactly one name'],
    [['--socket', '/a', 'n'], 'supply all three target options'],
  ])('rejects arguments %j with exit 2', (args, message) => {
    const result = run('tmux-name.sh', args)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(message)
  })

  it('accepts a name after --', () => {
    const result = run('tmux-name.sh', ['--', '-dash-name'])
    expect(result.status).toBe(0)
    expect(result.log).toContain('rename-window -t %1 -- -dash-name')
  })
})

describe('tmux-read-title.sh', () => {
  it('prints the verified pane title', () => {
    const result = run('tmux-read-title.sh', [], { FAKE_TMUX_TITLE: 'my-topic' })
    expect(result).toMatchObject({ status: 0, stdout: 'my-topic\n' })
  })

  it('refuses an unverified pane', () => {
    const result = run('tmux-read-title.sh', [], { FAKE_TMUX_PANE_PATH: tmpdir() })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })
})

describe('tmux-agent-reminder.sh', () => {
  it('emits valid SessionStart JSON naming the configured rename command', () => {
    const result = run('tmux-agent-reminder.sh', ['session-start'], {
      TMUX_NAME_COMMAND: 'rename "it"',
    })
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(parsed.hookSpecificOutput.additionalContext).toContain('Run: rename "it" <name>')
    expect(parsed.hookSpecificOutput.additionalContext).toContain('\n')
  })

  it('defaults the rename command', () => {
    const result = run('tmux-agent-reminder.sh', ['session-start'])
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain(
      'Run: vouchington tmux name <name>',
    )
  })

  it.each(['', 'cursor', 'grok', 'zsh'])('asks for a name when the pane title is %j', (title) => {
    const result = run('tmux-agent-reminder.sh', ['user-prompt'], { FAKE_TMUX_TITLE: title })
    expect(result.stdout).toContain('[tmux-window-name] Topic is clear')
  })

  it('stays quiet when the pane already has a topic or the event is unknown', () => {
    expect(
      run('tmux-agent-reminder.sh', ['user-prompt'], { FAKE_TMUX_TITLE: 'my-feature' }).stdout,
    ).toBe('')
    expect(run('tmux-agent-reminder.sh', ['other']).stdout).toBe('')
  })

  it('stays silent outside tmux', () => {
    const result = run('tmux-agent-reminder.sh', ['session-start'], {
      AGENT_TMUX_SOCKET: undefined,
      AGENT_TMUX_PANE: undefined,
      AGENT_TMUX_WORKTREE: undefined,
    })
    expect(result).toMatchObject({ status: 0, stdout: '', stderr: '' })
  })

  it('refuses a mismatched pane before reading its title, exiting 0', () => {
    const result = run('tmux-agent-reminder.sh', ['user-prompt'], { FAKE_TMUX_PANE_PATH: tmpdir() })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('pane belongs to a different worktree')
  })

  it('uses TMUX_TARGET_BIN instead of a decoy tmux on PATH', () => {
    const decoyDir = join(dir, 'decoy')
    mkdirSync(decoyDir)
    const marker = join(dir, 'invoked')
    writeFileSync(join(decoyDir, 'tmux'), `#!/bin/bash\ntouch ${JSON.stringify(marker)}\n`, {
      mode: 0o755,
    })
    const result = run('tmux-agent-reminder.sh', ['user-prompt'], {
      PATH: `${decoyDir}:${process.env.PATH ?? ''}`,
      FAKE_TMUX_TITLE: 'my-feature',
    })
    expect(result.status).toBe(0)
    expect(existsSync(marker)).toBe(false)
  })
})
