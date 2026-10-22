import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runDeadCodeCli, USAGE } from './cli.mts'
import { fixture, type Fixture } from './gate.test-helpers.mts'

let current: Fixture | undefined

afterEach(async () => {
  if (current) await rm(dirname(current.repo), { recursive: true, force: true })
  current = undefined
})

function sink() {
  return { error: vi.fn(), log: vi.fn() }
}

describe('runDeadCodeCli', () => {
  it('rejects unknown flags, a missing baseline, and conflicting modes with exit 2', async () => {
    const output = sink()
    expect(await runDeadCodeCli(['--bogus'], output)).toBe(2)
    expect(output.error).toHaveBeenLastCalledWith(expect.stringContaining(USAGE))
    expect(await runDeadCodeCli([], output)).toBe(2)
    expect(output.error).toHaveBeenLastCalledWith(expect.stringContaining('--baseline is required'))
    expect(await runDeadCodeCli(['--baseline', 'b.json', '--seed', '--update'], output)).toBe(2)
    expect(output.error).toHaveBeenLastCalledWith(expect.stringContaining('mutually exclusive'))
  })

  it('seeds, checks, and updates through flags', async () => {
    current = await fixture()
    const base = [
      '--repo-root',
      current.repo,
      '--baseline',
      'baseline.json',
      '--binary',
      current.binary,
    ]
    const output = sink()
    expect(
      await runDeadCodeCli([...base, '--seed', '--entry', 'main.mts', '--exclude', 'x/**'], output),
    ).toBe(0)
    expect(output.log).toHaveBeenLastCalledWith(
      'Seeded dead-code baseline with 1 identities from 3 tracked files',
    )
    expect(
      await runDeadCodeCli(
        [...base, '--config', '.jscpd.json', '--snapshot-ignore', 'none'],
        output,
      ),
    ).toBe(0)
    expect(output.log).toHaveBeenLastCalledWith(
      'Dead-code baseline matches 1 identities across 3 tracked files',
    )
    expect(await runDeadCodeCli([...base, '--update'], output)).toBe(0)
    expect(output.log).toHaveBeenLastCalledWith(
      'Dead-code baseline removed 0 stale identities; 1 remain',
    )
  })

  it('reports gate failures with exit 1', async () => {
    current = await fixture()
    const output = sink()
    expect(
      await runDeadCodeCli(
        ['--repo-root', current.repo, '--baseline', 'baseline.json', '--binary', current.binary],
        output,
      ),
    ).toBe(1)
    expect(output.error).toHaveBeenLastCalledWith(expect.stringContaining('baseline is missing'))
  })

  it('defaults to console output and the working directory', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await runDeadCodeCli([])).toBe(2)
    error.mockRestore()
  })
})
