import { afterEach, describe, expect, it, vi } from 'vitest'

import { runStorybookBrowserRunnerCommand } from './storybook-browser-runner.mts'

afterEach(() => vi.restoreAllMocks())

function capture() {
  const err: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true))
  return err
}

describe('runStorybookBrowserRunnerCommand', () => {
  it('runs the parsed project and returns the resolved exit code', async () => {
    const run = vi.fn(async () => 7)
    await expect(
      runStorybookBrowserRunnerCommand(['--project', 'ui', '--result-file', 'r.json'], run),
    ).resolves.toBe(7)
    expect(run).toHaveBeenCalledWith({ projectName: 'ui', resultFiles: ['r.json'] })
  })

  it('exits 2 with usage when the flags are invalid', async () => {
    const err = capture()
    const run = vi.fn(async () => 0)
    await expect(runStorybookBrowserRunnerCommand([], run)).resolves.toBe(2)
    expect(run).not.toHaveBeenCalled()
    expect(err.join('')).toContain('--project <name> is required')
    expect(err.join('')).toContain('storybook-browser-runner --project')
  })

  it('rejects Windows before running anything', async () => {
    const err = capture()
    const run = vi.fn(async () => 0)
    await expect(runStorybookBrowserRunnerCommand(['--project', 'ui'], run, 'win32')).resolves.toBe(
      1,
    )
    expect(run).not.toHaveBeenCalled()
    expect(err.join('')).toContain('POSIX-only')
  })

  it('exits 1 when the runner throws', async () => {
    const err = capture()
    await expect(
      runStorybookBrowserRunnerCommand(['--project', 'ui'], async () => {
        throw new Error('boom')
      }),
    ).resolves.toBe(1)
    await expect(
      runStorybookBrowserRunnerCommand(['--project', 'ui'], async () => {
        throw 'plain'
      }),
    ).resolves.toBe(1)
    expect(err.join('')).toContain('vouchington: boom')
    expect(err.join('')).toContain('vouchington: plain')
  })
})
