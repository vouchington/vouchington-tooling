import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFakeTmux } from './fake-tmux.test-helpers.mts'

// Only fd 0 (the hook payload on stdin) is replaced; every other read is real.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: ((path: unknown, ...rest: never[]) =>
      path === 0
        ? JSON.stringify({ tool_name: 'ExitPlanMode' })
        : (actual.readFileSync as (...args: unknown[]) => unknown)(
            path,
            ...rest,
          )) as typeof actual.readFileSync,
  }
})

const { runTmuxCommand } = await import('./cli.mts')

afterEach(() => vi.restoreAllMocks())

function capture() {
  const stdout: string[] = []
  const stderr: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation(
    (chunk) => (stdout.push(String(chunk)), true),
  )
  vi.spyOn(process.stderr, 'write').mockImplementation(
    (chunk) => (stderr.push(String(chunk)), true),
  )
  return { stdout, stderr }
}

describe('runTmuxCommand default streams', () => {
  it('reads the hook payload from stdin and writes the reminder to stdout', () => {
    const { stdout } = capture()
    const spawnPaneTitle = () => ({ status: 0, stdout: 'topic' })
    expect(runTmuxCommand(['post-tool'], { spawnPaneTitle })).toBe(0)
    expect(stdout.join('')).toContain('Plan accepted')
  })

  it('writes dispatch and flag errors to stderr', () => {
    const { stderr } = capture()
    expect(runTmuxCommand(['bogus'])).toBe(2)
    expect(runTmuxCommand(['up'])).toBe(2)
    expect(stderr.join('')).toContain('expected: up|name')
    expect(stderr.join('')).toContain('--config is required')
  })

  it('writes launcher output to stdout and uses the process environment', () => {
    const { stdout } = capture()
    const dir = mkdtempSync(join(tmpdir(), 'tmux-defaults-'))
    try {
      writeFileSync(
        join(dir, 'tmux.json'),
        JSON.stringify({ windows: [{ name: 'w', command: 'c' }] }),
      )
      const fake = createFakeTmux()
      const status = runTmuxCommand(
        ['up', '--config', join(dir, 'tmux.json'), '--root', dir, '--no-attach'],
        {
          tmux: fake.run,
          hasChildren: () => true,
        },
      )
      expect(status).toBe(0)
      expect(stdout.join('')).toContain('Services started')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
