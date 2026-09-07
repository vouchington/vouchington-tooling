import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  installCalls,
  makeFixture,
  resetInstallCalls,
  runInstaller,
} from './pnpm-install-fixture.test-helpers.mts'

const forced =
  'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false'
const secondScriptFree = `${forced} --ignore-scripts`

describe('pending build lifecycle safety', () => {
  it('uses pnpm generic pending rebuild when an enabled ordinary install leaves dependency debt', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      await resetInstallCalls(fixture)
      fixture.env.PNPM_PENDING_BUILDS = 'dependency'
      await runInstaller(fixture)
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
        'rebuild --pending --recursive',
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it.each(['pendingBuilds: [dependency]\n', 'pendingBuilds: nope\n'])(
    'reconciles a matching verified stamp when its live ledger is not clear',
    async (modules) => {
      const fixture = await makeFixture()
      try {
        await runInstaller(fixture)
        await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), modules)
        await resetInstallCalls(fixture)
        const result = await runInstaller(fixture)
        await expect(installCalls(fixture)).resolves.toEqual([
          `${forced} --ignore-scripts --ignore-pnpmfile`,
          secondScriptFree,
        ])
        expect(result.stderr).toContain('pending-build-ledger-unverified')
        expect(
          JSON.parse(
            await readFile(
              join(fixture.root, 'node_modules', '.pnpm-install-metadata-health.json'),
              'utf8',
            ),
          ),
        ).toMatchObject({
          scriptsEnabledInstallVerified: true,
          version: 5,
        })
      } finally {
        await rm(fixture.root, { force: true, recursive: true })
      }
    },
  )

  it('does not retain verification after a script-disabled install leaves pending debt', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      fixture.env.PNPM_PENDING_BUILDS = 'dependency'
      await runInstaller(fixture, { installScripts: false })
      const stamp = JSON.parse(
        await readFile(
          join(fixture.root, 'node_modules', '.pnpm-install-metadata-health.json'),
          'utf8',
        ),
      ) as Record<string, unknown>
      expect(stamp.scriptsEnabledInstallVerified).toBe(false)
      fixture.env.PNPM_PENDING_BUILDS = ''
      await resetInstallCalls(fixture)
      await runInstaller(fixture)
      await expect(installCalls(fixture)).resolves.toEqual([
        `${forced} --ignore-scripts --ignore-pnpmfile`,
        secondScriptFree,
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('allows an unreadable script-disabled ledger but requires enabled reconciliation next', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture, { installScripts: false })
      await rm(join(fixture.root, 'node_modules', '.modules.yaml'))
      await runInstaller(fixture, { installScripts: false })
      expect(
        JSON.parse(
          await readFile(
            join(fixture.root, 'node_modules', '.pnpm-install-metadata-health.json'),
            'utf8',
          ),
        ),
      ).toMatchObject({ scriptsEnabledInstallVerified: false })
      await resetInstallCalls(fixture)
      await runInstaller(fixture)
      await expect(installCalls(fixture)).resolves.toEqual([
        `${forced} --ignore-scripts --ignore-pnpmfile`,
        secondScriptFree,
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('does not stamp scripts-enabled success when pnpm leaves its pending ledger malformed', async () => {
    const fixture = await makeFixture()
    try {
      fixture.env.PNPM_REBUILD_INVALID_LEDGER = '1'
      fixture.env.PNPM_PENDING_BUILDS = 'dependency'
      await expect(runInstaller(fixture)).rejects.toThrow(
        'persistent install completed without a clear pending build ledger',
      )
      await expect(
        readFile(join(fixture.root, 'node_modules', '.pnpm-install-metadata-health.json'), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('fails before stamp when an enabled ordinary install leaves an unreadable ledger', async () => {
    const fixture = await makeFixture()
    try {
      fixture.env.PNPM_INVALID_PENDING_BUILDS = '1'
      await expect(runInstaller(fixture)).rejects.toThrow(
        'persistent install completed without a clear pending build ledger',
      )
      await expect(
        readFile(join(fixture.root, 'node_modules', '.pnpm-install-metadata-health.json'), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })
})
