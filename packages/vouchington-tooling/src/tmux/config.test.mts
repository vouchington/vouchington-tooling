import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { loadTmuxConfig, parseTmuxConfig } from './config.mts'
import { quoteShellArg, windowCommand } from './shell-quote.mts'
import { tmuxSessionName } from './session-name.mts'

const dirs: string[] = []
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tmux-config-'))
  dirs.push(dir)
  return dir
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const minimal = { windows: [{ name: 'web', command: 'serve' }] }

describe('parseTmuxConfig', () => {
  it('applies neutral defaults', () => {
    expect(parseTmuxConfig(minimal)).toEqual({
      sessionPrefix: 'dev-',
      readyMarker: 'ready',
      launcherPidVar: 'TMUX_LAUNCHER_PID',
      env: {},
      summary: [],
      windows: [{ name: 'web', command: 'serve', env: {}, keepOpen: true }],
    })
  })

  it('keeps explicit values and stringifies numeric env values', () => {
    const config = parseTmuxConfig({
      sessionPrefix: 'x-',
      readyMarker: 'up',
      launcherPidVar: 'LAUNCHER',
      env: { PORT: 4318 },
      summary: ['hello'],
      windows: [{ name: 'a', command: 'c', cwd: 'sub', env: { N: 'v' }, keepOpen: false }],
    })
    expect(config.env).toEqual({ PORT: '4318' })
    expect(config.windows[0]).toEqual({
      name: 'a',
      command: 'c',
      cwd: 'sub',
      env: { N: 'v' },
      keepOpen: false,
    })
    expect(config.summary).toEqual(['hello'])
  })

  it.each([
    [null, 'expected a JSON object'],
    [[], 'expected a JSON object'],
    [{}, 'windows must be a non-empty array'],
    [{ windows: [] }, 'windows must be a non-empty array'],
    [{ windows: ['x'] }, 'windows[0] must be an object'],
    [{ windows: [{ name: 'a b', command: 'c' }] }, 'windows[0].name must be a valid string'],
    [{ windows: [{ name: 'a', command: '' }] }, 'windows[0].command must be a non-empty string'],
    [{ windows: [{ name: 'a', command: 'c', cwd: 1 }] }, 'windows[0].cwd'],
    [{ windows: [{ name: 'a', command: 'c', keepOpen: 'no' }] }, 'keepOpen must be a boolean'],
    [{ windows: [{ name: 'a', command: 'c', env: [] }] }, 'windows[0].env must be an object'],
    [
      { windows: [{ name: 'a', command: 'c', env: { 'bad-name': '1' } }] },
      'invalid name "bad-name"',
    ],
    [
      { windows: [{ name: 'a', command: 'c', env: { OK: true } }] },
      'windows[0].env.OK must be a string or number',
    ],
    [
      {
        windows: [
          { name: 'a', command: 'c' },
          { name: 'a', command: 'd' },
        ],
      },
      'window names must be unique',
    ],
    [{ ...minimal, summary: 'x' }, 'summary must be an array of strings'],
    [{ ...minimal, summary: [1] }, 'summary must be an array of strings'],
    [{ ...minimal, sessionPrefix: '' }, 'sessionPrefix must be a valid string'],
    [{ ...minimal, launcherPidVar: 'a-b' }, 'launcherPidVar'],
  ])('rejects %j', (value, message) => {
    expect(() => parseTmuxConfig(value)).toThrow(message)
  })
})

describe('loadTmuxConfig', () => {
  it('loads a JSON file', () => {
    const path = join(temp(), 'tmux.json')
    writeFileSync(path, JSON.stringify(minimal))
    expect(loadTmuxConfig(path).windows).toHaveLength(1)
  })

  it('names an unreadable file', () => {
    expect(() => loadTmuxConfig(join(temp(), 'missing.json'))).toThrow('cannot read')
  })

  it('names invalid JSON', () => {
    const path = join(temp(), 'bad.json')
    writeFileSync(path, '{')
    expect(() => loadTmuxConfig(path)).toThrow('is not valid JSON')
  })

  it('passes validation errors through', () => {
    const path = join(temp(), 'empty.json')
    writeFileSync(path, '{}')
    expect(() => loadTmuxConfig(path)).toThrow('windows must be a non-empty array')
  })
})

describe('shell quoting', () => {
  it('quotes embedded apostrophes', () => {
    expect(quoteShellArg("it's")).toBe("'it'\\''s'")
  })

  it('layers extra, shared and window env with later layers winning', () => {
    const config = parseTmuxConfig({ ...minimal, env: { A: 'shared', B: 'shared' } })
    const window = { name: 'w', command: 'run', env: { B: 'window' }, keepOpen: true }
    expect(windowCommand(config, window, { A: 'extra', C: 'extra' })).toBe(
      "A='shared' C='extra' B='window' bash -lc 'run; read'",
    )
  })

  it('omits assignments and the read suffix when there are none', () => {
    const config = parseTmuxConfig(minimal)
    expect(windowCommand(config, { name: 'w', command: 'run', env: {}, keepOpen: false })).toBe(
      "bash -lc 'run'",
    )
  })
})

describe('tmuxSessionName', () => {
  it('is stable for one path and differs between same-basename directories', () => {
    const first = join(temp(), 'repo')
    const second = join(temp(), 'repo')
    mkdirSync(first)
    mkdirSync(second)
    expect(tmuxSessionName('dev-', first)).toBe(tmuxSessionName('dev-', first))
    expect(tmuxSessionName('dev-', first)).toMatch(/^dev-d[0-9a-f]{12}$/)
    expect(tmuxSessionName('dev-', first)).not.toBe(tmuxSessionName('dev-', second))
  })
})
