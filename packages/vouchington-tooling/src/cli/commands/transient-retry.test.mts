import { afterEach, describe, expect, it, vi } from 'vitest'

import { runCli } from '../index.mts'
import { parseCli } from '../parse.mts'
import { runTransientRetryCommand } from './transient-retry.mts'

const rerun = vi.hoisted(() => vi.fn(async (_options: unknown) => 0))
vi.mock('../../transient-retry/rerun.mts', () => ({ rerunKnownTransient: rerun }))

const rules = [{ id: 'r', maxAttempts: 1, match: () => true }]

function stderr() {
  const writes: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  return writes
}

afterEach(() => {
  vi.restoreAllMocks()
  rerun.mockClear()
})

describe('transient-retry command', () => {
  it('is a forwarded command', () => {
    expect(parseCli(['node', 'vouchington', 'transient-retry', '--rules', 'm', '1'])).toEqual({
      kind: 'transient-retry',
      args: ['--rules', 'm', '1'],
    })
  })

  it('runs the engine with rules and limits loaded from the module', async () => {
    const limits = { totalBytes: 5 }
    const load = vi.fn(async () => ({ rules, limits }))

    const code = await runTransientRetryCommand(
      ['--rules', 'rules.mjs', '--repo', 'acme/widgets', '--dry-run', '--token-env', 'T', '42'],
      { GITHUB_REPOSITORY: 'ignored/ignored' },
      load,
    )

    expect(code).toBe(0)
    expect(load).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/.*\/rules\.mjs$/))
    expect(rerun).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        limits,
        repository: 'acme/widgets',
        rules,
        runId: '42',
      }),
    )
  })

  it('falls back to GITHUB_REPOSITORY and omits absent limits', async () => {
    await runTransientRetryCommand(
      ['--rules', 'm', '7'],
      { GITHUB_REPOSITORY: 'acme/widgets' },
      async () => ({ rules }),
    )
    const options = rerun.mock.calls[0]![0] as Record<string, unknown>
    expect(options).toMatchObject({ repository: 'acme/widgets', dryRun: false })
    expect(options).not.toHaveProperty('limits')

    rerun.mockClear()
    await runTransientRetryCommand(['--rules', 'm', '7'], {}, async () => ({ rules }))
    expect(rerun.mock.calls[0]![0]).not.toHaveProperty('repository')
  })

  it('returns the engine exit code', async () => {
    rerun.mockResolvedValueOnce(2)
    await expect(
      runTransientRetryCommand(['--rules', 'm', '7'], {}, async () => ({ rules })),
    ).resolves.toBe(2)
  })

  it.each([
    [['--rules', 'm']],
    [['7']],
    [['--rules', 'm', '1', '2']],
    [['--nope', '--rules', 'm', '1']],
  ])('rejects bad usage %j', async (args) => {
    const writes = stderr()
    await expect(runTransientRetryCommand(args, {}, async () => ({ rules }))).resolves.toBe(2)
    expect(writes.join('')).toContain('transient-retry --rules <module>')
    expect(rerun).not.toHaveBeenCalled()
  })

  it('fails when the module cannot load or exports no rules array', async () => {
    const writes = stderr()
    await expect(
      runTransientRetryCommand(['--rules', 'm', '1'], {}, async () => ({ rules: 'nope' })),
    ).resolves.toBe(1)
    await expect(
      runTransientRetryCommand(['--rules', 'm', '1'], {}, () => Promise.reject('gone')),
    ).resolves.toBe(1)
    expect(writes.join('')).toContain('rules module must export a `rules` array')
    expect(writes.join('')).toContain('vouchington: gone')
  })

  it('loads a real module by path through the CLI dispatcher', async () => {
    const writes = stderr()
    const code = await runCli([
      'node',
      'vouchington',
      'transient-retry',
      '--rules',
      '/missing.mjs',
      '1',
    ])
    expect(code).toBe(1)
    expect(writes.join('')).toContain('/missing.mjs')
  })
})
