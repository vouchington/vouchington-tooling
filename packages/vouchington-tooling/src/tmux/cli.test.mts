import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runTmuxCommand, TMUX_USAGE } from './cli.mts'
import { createFakeTmux } from './fake-tmux.test-helpers.mts'
import { createTmuxRun, pgrepHasChildren, sleepMs } from './runner.mts'

let dir: string
let out: string[]
let err: string[]

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'tmux-cli-')))
  out = []
  err = []
  writeFileSync(
    join(dir, 'tmux.json'),
    JSON.stringify({ sessionPrefix: 'p-', windows: [{ name: 'web', command: 'serve' }] }),
  )
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const io = () => ({
  out: (text: string) => void out.push(text),
  err: (text: string) => void err.push(text),
})

describe('runTmuxCommand: up', () => {
  function up(args: string[], extra: Parameters<typeof runTmuxCommand>[1] = {}) {
    const fake = createFakeTmux()
    const status = runTmuxCommand(['up', ...args], {
      cwd: dir,
      env: {},
      tmux: fake.run,
      hasChildren: () => true,
      sleep: () => undefined,
      pid: 7,
      ...io(),
      ...extra,
    })
    return { status, fake }
  }

  it('starts the configured windows, tagging the log level', () => {
    const { status, fake } = up(['--config', 'tmux.json', '--no-attach', '--verbose'])
    expect(status).toBe(0)
    const create = fake.calls.find((call) => call[0] === 'new-session')!
    expect(create[create.indexOf('-s') + 1]).toMatch(/^p-d[0-9a-f]{12}$/)
    expect(create.at(-1)).toBe("TMUX_LOG_LEVEL='info' bash -lc 'serve; read'")
    expect(out.join('')).toContain('Services started')
  })

  it('defaults to the error log level and honors --root', () => {
    const root = join(dir, 'root')
    mkdirSync(root)
    const { status, fake } = up(['--config', 'tmux.json', '--root', root, '--no-attach'])
    expect(status).toBe(0)
    expect(fake.calls.find((call) => call[0] === 'new-session')!.at(-2)).toBe(root)
    expect(fake.calls.find((call) => call[0] === 'new-session')!.at(-1)).toContain(
      "TMUX_LOG_LEVEL='error'",
    )
  })

  it('takes the root from TMUX_TARGET_ROOT', () => {
    const { status } = up(['--config', 'tmux.json', '--no-attach'], {
      env: { TMUX_TARGET_ROOT: dir },
    })
    expect(status).toBe(0)
  })

  it.each([
    [[], '--config is required'],
    [['--config'], 'missing value for --config'],
    [['--config', 'x', '--root', ''], 'missing value for --root'],
    [['--config', 'x', '--bogus'], 'unknown option: --bogus'],
    [['--config', 'x', '-v', '--verbose'], 'duplicate option: --verbose'],
    [['--config', 'x', '--no-attach', '--no-attach'], 'duplicate option: --no-attach'],
  ])('rejects %j with usage', (args, message) => {
    const { status } = up(args)
    expect(status).toBe(2)
    expect(err.join('')).toContain(message)
    expect(err.join('')).toContain(TMUX_USAGE)
  })

  it('reports config errors with exit 2', () => {
    const { status } = up(['--config', 'missing.json', '--no-attach'])
    expect(status).toBe(2)
    expect(err.join('')).toContain('cannot read')
  })

  it('fails when tmux is not installed', () => {
    const fake = createFakeTmux({ failOn: ['-V'] })
    const status = runTmuxCommand(['up', '--config', 'tmux.json'], {
      cwd: dir,
      env: {},
      tmux: fake.run,
      ...io(),
    })
    expect(status).toBe(1)
    expect(err.join('')).toContain('tmux is not installed')
  })

  it('refuses to attach from inside tmux but allows --no-attach', () => {
    const inside = up(['--config', 'tmux.json'], { env: { TMUX: '/s,1,0' } })
    expect(inside.status).toBe(1)
    expect(err.join('')).toContain('outside tmux')
    expect(up(['--config', 'tmux.json', '--no-attach'], { env: { TMUX: '/s,1,0' } }).status).toBe(0)
  })
})

describe('runTmuxCommand: up with the real runner', () => {
  function writeFakeTmux(): { bin: string; log: string } {
    const bin = join(dir, 'fake-tmux')
    const log = join(dir, 'tmux.log')
    writeFileSync(log, '')
    writeFileSync(
      bin,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$1" in
  has-session) test -e ${JSON.stringify(join(dir, 'session'))} ;;
  new-session) touch ${JSON.stringify(join(dir, 'session'))} ;;
  show-options) echo 1 ;;
  list-windows) echo web ;;
  list-panes) echo 99999999 ;;
  *) exit 0 ;;
esac
`,
    )
    chmodSync(bin, 0o755)
    return { bin, log }
  }

  it('creates a session, then reuses it, through TMUX_TARGET_BIN', () => {
    const { bin, log } = writeFakeTmux()
    const env = { TMUX_TARGET_BIN: bin, PATH: process.env.PATH }
    const run = () =>
      runTmuxCommand(['up', '--config', 'tmux.json', '--no-attach'], { cwd: dir, env, ...io() })
    expect(run()).toBe(0)
    expect(readFileSync(log, 'utf8')).toContain('new-session -d -s p-d')
    expect(out.join('')).toContain('Services started')
    expect(run()).toBe(0)
    expect(readFileSync(log, 'utf8')).toContain('respawn-pane -k')
  })

  it('treats a missing binary as not installed', () => {
    const status = runTmuxCommand(['up', '--config', 'tmux.json'], {
      cwd: dir,
      env: { TMUX_TARGET_BIN: join(dir, 'nope') },
      ...io(),
    })
    expect(status).toBe(1)
    expect(err.join('')).toContain('not installed')
  })

  it('attaches with inherited stdio', () => {
    const { bin, log } = writeFakeTmux()
    const status = runTmuxCommand(['up', '--config', 'tmux.json'], {
      cwd: dir,
      env: { TMUX_TARGET_BIN: bin, PATH: process.env.PATH },
      ...io(),
    })
    expect(status).toBe(0)
    expect(readFileSync(log, 'utf8')).toContain('attach -t =p-d')
  })

  it('asks pgrep for children of the pane process', () => {
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'pgrep'), '#!/usr/bin/env bash\n[ "$1 $2 $3" = "-P 42 ." ]\n', {
      mode: 0o755,
    })
    vi.stubEnv('PATH', `${bin}:${process.env.PATH ?? ''}`)
    try {
      expect(pgrepHasChildren('42')).toBe(true)
      expect(pgrepHasChildren('43')).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('sleeps for the requested time', () => {
    const started = Date.now()
    sleepMs(30)
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
  })

  it('returns a null status when the binary cannot be spawned', () => {
    expect(createTmuxRun(join(dir, 'missing'))(['-V'])).toEqual({ status: null, stdout: '' })
  })
})

describe('runTmuxCommand: other subcommands', () => {
  it.each(['name', 'read-title', 'agent-reminder'])(
    'runs the %s script through bash',
    (subcommand) => {
      const scriptSpawn = vi.fn(() => ({ status: 5 }))
      expect(runTmuxCommand([subcommand, 'arg'], { spawn: scriptSpawn })).toBe(5)
      expect(scriptSpawn).toHaveBeenCalledWith(
        'bash',
        [expect.stringMatching(new RegExp(`scripts/tmux/tmux-${subcommand}\\.sh$`)), 'arg'],
        { stdio: 'inherit' },
      )
    },
  )

  it('prints a post-tool reminder from a hook payload on stdin', () => {
    const readStdin = () => JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    expect(runTmuxCommand(['post-tool'], { readStdin, env: {}, ...io() })).toBe(0)
    expect(out).toEqual([])
  })

  it('emits the reminder text when a checkpoint matches', () => {
    const readStdin = () => JSON.stringify({ tool_name: 'ExitPlanMode' })
    const spawnPaneTitle = () => ({ status: 0, stdout: 'topic\n' })
    expect(runTmuxCommand(['post-tool'], { readStdin, spawnPaneTitle, env: {}, ...io() })).toBe(0)
    expect(out.join('')).toContain('Plan accepted')
    expect(out.join('').endsWith('\n')).toBe(true)
  })

  it.each([[[]], [['bogus']], [['post-tool', 'extra']]])('rejects %j with usage', (args) => {
    expect(runTmuxCommand(args, err_only())).toBe(2)
    expect(err.join('')).toContain('expected: up|name|read-title|agent-reminder|post-tool')
  })
})

function err_only() {
  return { err: (text: string) => void err.push(text) }
}
