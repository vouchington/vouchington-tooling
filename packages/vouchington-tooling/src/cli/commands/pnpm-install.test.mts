import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../pnpm-install/index.mts', () => ({
  parseInstallOptions: vi.fn(() => ({ runnerLifecycle: 'persistent' })),
  runInstallLifecycle: vi.fn(async () => 'persistent ordinary'),
}))

import { parseInstallOptions, runInstallLifecycle } from '../../pnpm-install/index.mts'
import { runPnpmInstallCli } from './pnpm-install.mts'

describe('runPnpmInstallCli', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  afterEach(() => {
    stderr.mockClear()
    warn.mockClear()
    delete process.env.GITHUB_STEP_SUMMARY
    vi.mocked(runInstallLifecycle).mockReset()
    vi.mocked(runInstallLifecycle).mockResolvedValue('persistent ordinary')
    vi.mocked(parseInstallOptions).mockReset()
    vi.mocked(parseInstallOptions).mockReturnValue({
      commandTimeoutSeconds: 0,
      ephemeralWorkspaces: '',
      installScripts: true,
      maxAttempts: 1,
      runnerLifecycle: 'persistent',
    })
  })

  it('returns 0 and appends a step summary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pnpm-install-cli-'))
    const summary = join(directory, 'summary.md')
    process.env.GITHUB_STEP_SUMMARY = summary
    expect(
      await runPnpmInstallCli(['--runner-lifecycle', 'persistent', '--install-scripts', 'true']),
    ).toBe(0)
    await expect(
      import('node:fs/promises').then((fs) => fs.readFile(summary, 'utf8')),
    ).resolves.toMatch(/pnpm install: persistent ordinary completed in \d+ms/)
    await rm(directory, { recursive: true, force: true })
  })

  it('returns 1 and still warns when the summary cannot be written', async () => {
    vi.mocked(runInstallLifecycle).mockRejectedValue(new Error('boom'))
    process.env.GITHUB_STEP_SUMMARY = join(tmpdir())
    expect(await runPnpmInstallCli(['--runner-lifecycle', 'persistent'])).toBe(1)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('boom')
    expect(warn).toHaveBeenCalled()
  })

  it('returns 1 for a non-error rejection', async () => {
    vi.mocked(runInstallLifecycle).mockRejectedValue('nope')
    delete process.env.GITHUB_STEP_SUMMARY
    expect(await runPnpmInstallCli([])).toBe(1)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('nope')
  })
})
