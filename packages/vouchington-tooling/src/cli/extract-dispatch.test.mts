import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./commands/pnpm-install.mts', () => ({
  runPnpmInstallCli: vi.fn(async () => 0),
}))
vi.mock('./commands/vitest-blob-manifest.mts', () => ({
  runVitestBlobManifestCommand: vi.fn(() => 0),
}))

import { runCli } from './index.mts'
import { runPnpmInstallCli } from './commands/pnpm-install.mts'
import { runVitestBlobManifestCommand } from './commands/vitest-blob-manifest.mts'

describe('runCli extract command dispatch', () => {
  afterEach(() => {
    vi.mocked(runPnpmInstallCli).mockClear()
    vi.mocked(runVitestBlobManifestCommand).mockClear()
  })

  it('forwards pnpm-install and vitest-blob-manifest to their commands', async () => {
    await expect(
      runCli([
        'node',
        'vouchington',
        'pnpm-install',
        '--runner-lifecycle',
        'persistent',
        '--install-scripts',
        'true',
      ]),
    ).resolves.toBe(0)
    expect(vi.mocked(runPnpmInstallCli)).toHaveBeenCalledOnce()
    expect(runCli(['node', 'vouchington', 'vitest-blob-manifest', 'tooling'])).toBe(0)
    expect(vi.mocked(runVitestBlobManifestCommand)).toHaveBeenCalledWith(['tooling'])
  })
})
