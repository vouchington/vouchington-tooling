import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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

async function addMismatchedNative(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  const addon = join(
    fixture.root,
    'node_modules',
    '.pnpm',
    'native@1.0.0',
    'node_modules',
    'native',
    'addon.node',
  )
  await mkdir(join(addon, '..'), { recursive: true })
  await writeFile(
    addon,
    process.platform === 'darwin'
      ? Buffer.from([0x7f, 0x45, 0x4c, 0x46])
      : Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  )
  fixture.env.PNPM_NATIVE_ADDON = addon
  return addon
}

describe('native health repair lifecycle', () => {
  it('uses one strict forced script-free install only with known-clean ignored builds', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture, { installScripts: false })
      await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), 'ignoredBuilds: []\n')
      await addMismatchedNative(fixture)
      fixture.env.PNPM_REPAIR_NATIVE = '1'
      await resetInstallCalls(fixture)
      await runInstaller(fixture, { installScripts: false })
      await expect(installCalls(fixture)).resolves.toEqual([`${forced} --ignore-scripts`])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it.each([undefined, 'ignoredBuilds: nope\n', 'ignoredBuilds: [native]\n'])(
    'keeps the two-pass repair when ignored-build state is unsafe',
    async (modules) => {
      const fixture = await makeFixture()
      try {
        await runInstaller(fixture)
        if (modules !== undefined)
          await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), modules)
        await addMismatchedNative(fixture)
        fixture.env.PNPM_REPAIR_NATIVE = '1'
        await resetInstallCalls(fixture)
        await runInstaller(fixture)
        await expect(installCalls(fixture)).resolves.toEqual([
          `${forced} --ignore-scripts --ignore-pnpmfile`,
          forced,
        ])
      } finally {
        await rm(fixture.root, { force: true, recursive: true })
      }
    },
  )

  it('keeps the two-pass repair when workspace links are stale', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), 'ignoredBuilds: []\n')
      await addMismatchedNative(fixture)
      await rm(fixture.dependencyLink)
      fixture.env.PNPM_REPAIR_LINK = '1'
      fixture.env.PNPM_REPAIR_NATIVE = '1'
      await resetInstallCalls(fixture)
      await runInstaller(fixture)
      await expect(installCalls(fixture)).resolves.toEqual([
        `${forced} --ignore-scripts --ignore-pnpmfile`,
        forced,
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('does not refresh the stamp when the strict repair leaves a native mismatch', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      const stamp = join(fixture.root, 'node_modules', '.pnpm-install-metadata-health.json')
      const before = await readFile(stamp, 'utf8')
      await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), 'ignoredBuilds: []\n')
      await addMismatchedNative(fixture)
      await resetInstallCalls(fixture)
      await expect(runInstaller(fixture)).rejects.toThrow(
        'native health reconciliation completed with mismatched native binaries',
      )
      await expect(readFile(stamp, 'utf8')).resolves.toBe(before)
      await expect(installCalls(fixture)).resolves.toEqual([forced])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('does not refresh the stamp when two-pass repair leaves a native mismatch', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      const stamp = join(fixture.root, 'node_modules', '.pnpm-install-metadata-health.json')
      const before = await readFile(stamp, 'utf8')
      await writeFile(
        join(fixture.root, 'node_modules', '.modules.yaml'),
        'ignoredBuilds: [native]\n',
      )
      await addMismatchedNative(fixture)
      await resetInstallCalls(fixture)
      await expect(runInstaller(fixture)).rejects.toThrow(
        'persistent reconciliation completed with mismatched native binaries',
      )
      await expect(readFile(stamp, 'utf8')).resolves.toBe(before)
      await expect(installCalls(fixture)).resolves.toEqual([
        `${forced} --ignore-scripts --ignore-pnpmfile`,
        forced,
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('does not refresh the stamp when the strict repair leaves a stale workspace link', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      const stamp = join(fixture.root, 'node_modules', '.pnpm-install-metadata-health.json')
      const before = await readFile(stamp, 'utf8')
      await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), 'ignoredBuilds: []\n')
      await addMismatchedNative(fixture)
      fixture.env.PNPM_REPAIR_NATIVE = '1'
      fixture.env.PNPM_FORCE_BREAK_LINK = '1'
      await resetInstallCalls(fixture)
      await expect(runInstaller(fixture)).rejects.toThrow(
        'native health reconciliation completed with invalid workspace links',
      )
      await expect(readFile(stamp, 'utf8')).resolves.toBe(before)
      await expect(installCalls(fixture)).resolves.toEqual([forced])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })
})
