import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  installCalls,
  makeFixture,
  resetInstallCalls,
  runInstaller,
} from './pnpm-install-fixture.test-helpers.mts'

describe('pending build lifecycle safety', () => {
  it.each(['unknown', 'workspace'] as const)(
    'uses the full pending rebuild when a disabled install has %s pending state',
    async (scenario) => {
      const fixture = await makeFixture()
      try {
        await runInstaller(fixture)
        if (scenario === 'workspace') {
          await writeFile(
            join(fixture.root, 'node_modules', '.modules.yaml'),
            'pendingBuilds: []\n',
          )
          fixture.env.PNPM_PENDING_BUILDS = 'workspace-hook'
        } else await rm(join(fixture.root, 'node_modules', '.modules.yaml'), { force: true })
        await resetInstallCalls(fixture)
        await runInstaller(fixture, { installScripts: false })
        fixture.env.PNPM_PENDING_BUILDS = ''
        await runInstaller(fixture)
        await expect(installCalls(fixture)).resolves.toEqual([
          'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
          'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
          'rebuild --pending --recursive',
        ])
      } finally {
        await rm(fixture.root, { force: true, recursive: true })
      }
    },
  )

  it('fails closed for tampered dependency IDs without passing them to pnpm', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      const stampPath = join(fixture.root, 'node_modules', '.pnpm-install-metadata-health.json')
      const stamp = JSON.parse(await readFile(stampPath, 'utf8')) as Record<string, unknown>
      stamp.pendingDependencyBuilds = ['--dir']
      await writeFile(stampPath, `${JSON.stringify(stamp)}\n`)
      await resetInstallCalls(fixture)
      const result = await runInstaller(fixture)
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
        'rebuild --pending --recursive',
      ])
      expect(result.stderr).toContain('invalid-pending-dependency-builds')
      expect(result.stderr).not.toContain('--dir')
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('does not stamp success when a selective rebuild cannot update pnpm pending state', async () => {
    const fixture = await makeFixture()
    try {
      await writeFile(join(fixture.root, 'pnpm-lock.yaml'), 'packages:\n  dependency@1: {}\n')
      await runInstaller(fixture)
      await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), 'pendingBuilds: []\n')
      fixture.env.PNPM_PENDING_BUILDS = '"dependency@1"'
      await runInstaller(fixture, { installScripts: false })
      fixture.env.PNPM_PENDING_BUILDS = ''
      fixture.env.PNPM_REBUILD_INVALID_LEDGER = '1'
      await expect(runInstaller(fixture)).rejects.toThrow(
        'dependency rebuild completed but pending build ledger could not be updated safely',
      )
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })
})
