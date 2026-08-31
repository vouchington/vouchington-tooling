import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  installCalls,
  makeFixture,
  resetInstallCalls,
  runInstaller,
} from './pnpm-install-fixture.test-helpers.mts'

const stamp = join('node_modules', '.pnpm-install-metadata-health.json')

describe('pnpm install lifecycle', () => {
  it('runs one non-forced install for a cold tree and stamps it, then again for matching warm state', async () => {
    const fixture = await makeFixture()
    try {
      const cold = await runInstaller(fixture)
      expect(cold.stderr).toContain('persistent dependency tree is absent; installing cold')
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
      ])
      await expect(readFile(join(fixture.root, stamp), 'utf8')).resolves.toEqual(
        expect.stringContaining('"version":4'),
      )
      await resetInstallCalls(fixture)
      const result = await runInstaller(fixture)
      expect(result.stderr.match(/"event":"pnpm-install-persistent-provenance"/g)).toHaveLength(1)
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('reconciles a matching stamp when leftover natives do not match this runtime', async () => {
    const fixture = await makeFixture()
    try {
      const cold = await runInstaller(fixture)
      expect(cold.stderr).toContain('persistent dependency tree is absent; installing cold')
      await resetInstallCalls(fixture)
      const store = join(
        fixture.root,
        'node_modules',
        '.pnpm',
        'native@1.0.0',
        'node_modules',
        'native',
      )
      await mkdir(store, { recursive: true })
      await writeFile(
        join(store, 'addon.node'),
        process.platform === 'darwin'
          ? Buffer.from([0x7f, 0x45, 0x4c, 0x46])
          : Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
      )
      await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), 'ignoredBuilds: []\n')
      fixture.env.PNPM_NATIVE_ADDON = join(store, 'addon.node')
      fixture.env.PNPM_REPAIR_NATIVE = '1'
      const repaired = await runInstaller(fixture)
      expect(repaired.stderr).toContain(
        'persistent optional native binaries do not match this runtime; reconciling',
      )
      expect(repaired.stderr).toContain('"action":"reconcile"')
      expect(repaired.stderr).toContain('"nativeBinariesMatchRuntime":false')
      expect(repaired.stderr).toContain('"reason":"native-health-mismatch"')
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('falls back to reconciliation when a cold install leaves an invalid workspace link', async () => {
    const fixture = await makeFixture()
    try {
      await rm(fixture.dependencyLink)
      fixture.env.PNPM_REPAIR_LINK = '1'
      await expect(runInstaller(fixture)).resolves.toBeDefined()
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts --ignore-pnpmfile',
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('carries the script-disabled policy through a cold install', async () => {
    const fixture = await makeFixture()
    try {
      await expect(runInstaller(fixture, { installScripts: false })).resolves.toBeDefined()
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('keeps workspace-list warnings separate from JSON output', async () => {
    const fixture = await makeFixture()
    try {
      fixture.env.PNPM_LIST_WARNING = 'benign pnpm warning'
      await expect(runInstaller(fixture)).resolves.toBeDefined()
      await expect(installCalls(fixture)).resolves.toHaveLength(1)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('reconciles and re-verifies a missing first-party workspace link', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      await resetInstallCalls(fixture)
      await rm(fixture.dependencyLink)
      fixture.env.PNPM_REPAIR_LINK = '1'
      await expect(runInstaller(fixture)).resolves.toBeDefined()
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts --ignore-pnpmfile',
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('does not reconcile when the ordinary persistent install fails', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      await resetInstallCalls(fixture)
      fixture.env.PNPM_FAIL_CALL = '1'
      await expect(runInstaller(fixture)).rejects.toMatchObject({ code: 1 })
      await expect(installCalls(fixture)).resolves.toHaveLength(1)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('fails after reconciliation when a workspace link is still invalid', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      await resetInstallCalls(fixture)
      await rm(fixture.dependencyLink)
      await expect(runInstaller(fixture)).rejects.toMatchObject({ code: 1 })
      await expect(installCalls(fixture)).resolves.toHaveLength(3)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('preserves the script-disabled policy in warm and strict reconciliation installs', async () => {
    const fixture = await makeFixture()
    try {
      await expect(runInstaller(fixture, { installScripts: false })).resolves.toBeDefined()
      await resetInstallCalls(fixture)
      await expect(runInstaller(fixture, { installScripts: false })).resolves.toBeDefined()
      await rm(fixture.dependencyLink)
      fixture.env.PNPM_REPAIR_LINK = '1'
      await expect(runInstaller(fixture, { installScripts: false })).resolves.toBeDefined()
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts --ignore-pnpmfile',
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('reconciles valid links when dependency metadata inputs change', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      await resetInstallCalls(fixture)
      await writeFile(
        join(fixture.root, 'pnpm-workspace.yaml'),
        'packages:\n  - packages/*\nstrictDepBuilds: true\n',
      )
      await expect(runInstaller(fixture)).resolves.toBeDefined()
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts --ignore-pnpmfile',
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
      ])
      await resetInstallCalls(fixture)
      fixture.env.PNPM_VERSION = '11.1.0'
      await expect(runInstaller(fixture)).resolves.toBeDefined()
      await expect(installCalls(fixture)).resolves.toHaveLength(2)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('does not stamp metadata when strict reconciliation fails', async () => {
    const fixture = await makeFixture()
    try {
      await mkdir(join(fixture.root, 'node_modules'), { recursive: true })
      fixture.env.PNPM_FAIL_CALL = '2'
      await expect(runInstaller(fixture)).rejects.toMatchObject({ code: 1 })
      await resetInstallCalls(fixture)
      delete fixture.env.PNPM_FAIL_CALL
      await expect(runInstaller(fixture)).resolves.toBeDefined()
      await expect(installCalls(fixture)).resolves.toHaveLength(2)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('rejects selectors for persistent runners', async () => {
    const fixture = await makeFixture()
    try {
      await expect(
        runInstaller(fixture, { selectors: '@fixture/consumer...' }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('ephemeral-workspaces is only valid for ephemeral runners'),
      })
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('rejects empty, negative, flag-shaped, unbraced-path, and no-match ephemeral selectors', async () => {
    const fixture = await makeFixture()
    try {
      for (const selectors of [
        '',
        '!@fixture/consumer',
        '--filter @fixture/consumer',
        '@fixture/consumer... --prod',
      ]) {
        await expect(
          runInstaller(fixture, { lifecycle: 'ephemeral', selectors }),
        ).rejects.toMatchObject({ code: 1 })
      }
      for (const selectors of ['./consumer...', '../consumer...', '/consumer...']) {
        await expect(
          runInstaller(fixture, { lifecycle: 'ephemeral', selectors }),
        ).rejects.toMatchObject({ stderr: expect.stringContaining('must be brace-wrapped') })
      }
      fixture.env.PNPM_FAIL_CALL = '1'
      await expect(
        runInstaller(fixture, { lifecycle: 'ephemeral', selectors: '@fixture/missing' }),
      ).rejects.toMatchObject({ code: 1 })
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('runs one filtered non-forced install for an ephemeral runner', async () => {
    const fixture = await makeFixture()
    try {
      await expect(
        runInstaller(fixture, { lifecycle: 'ephemeral', selectors: '@fixture/consumer...' }),
      ).resolves.toBeDefined()
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --filter @fixture/consumer... --fail-if-no-match',
      ])
      await resetInstallCalls(fixture)
      await expect(
        runInstaller(fixture, { lifecycle: 'ephemeral', selectors: '{./packages/consumer}...' }),
      ).resolves.toBeDefined()
      await resetInstallCalls(fixture)
      await expect(
        runInstaller(fixture, { lifecycle: 'ephemeral', selectors: '.' }),
      ).resolves.toBeDefined()
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('runs one complete non-forced install for an ephemeral-full runner', async () => {
    const fixture = await makeFixture()
    try {
      await expect(runInstaller(fixture, { lifecycle: 'ephemeral-full' })).resolves.toBeDefined()
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('reports the selected install mode and duration to the step summary', async () => {
    const fixture = await makeFixture()
    try {
      await expect(runInstaller(fixture)).resolves.toBeDefined()
      await resetInstallCalls(fixture)
      await expect(runInstaller(fixture)).resolves.toBeDefined()
      await expect(readFile(fixture.summary, 'utf8')).resolves.toMatch(
        /pnpm install: persistent ordinary completed in \d+ms/,
      )
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('uses ordinary installs for warm true-to-false-to-true transitions after scripts have succeeded', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture, { installScripts: true })
      await resetInstallCalls(fixture)
      await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), 'pendingBuilds: []\n')
      await runInstaller(fixture, { installScripts: false })
      await runInstaller(fixture, { installScripts: true })
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('upgrades warm false-to-true transitions with a pending scripts rebuild', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture, { installScripts: false })
      await resetInstallCalls(fixture)
      await runInstaller(fixture, { installScripts: true })
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
        'rebuild --pending --recursive',
      ])
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('rebuilds only newly pending dependency IDs after a script-disabled install', async () => {
    const fixture = await makeFixture()
    try {
      await writeFile(join(fixture.root, 'pnpm-lock.yaml'), 'packages:\n  new-package@1.0.0: {}\n')
      await runInstaller(fixture, { installScripts: true })
      await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), 'pendingBuilds: []\n')
      await resetInstallCalls(fixture)
      fixture.env.PNPM_PENDING_BUILDS = '"new-package@1.0.0"'
      await runInstaller(fixture, { installScripts: false })
      fixture.env.PNPM_PENDING_BUILDS = ''
      const result = await runInstaller(fixture, { installScripts: true })
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
        'rebuild --recursive -- new-package@1.0.0',
      ])
      await expect(
        readFile(join(fixture.root, 'node_modules', '.modules.yaml'), 'utf8'),
      ).resolves.toBe('pendingBuilds: []\n')
      expect(result.stderr).not.toContain('new-package@1.0.0')
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('reconciles when a pending rebuild leaves a stale workspace link', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture, { installScripts: false })
      await resetInstallCalls(fixture)
      fixture.env.PNPM_REBUILD_BREAK_LINK = '1'
      fixture.env.PNPM_REPAIR_LINK = '1'
      const result = await runInstaller(fixture, { installScripts: true })
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
        'rebuild --pending --recursive',
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts --ignore-pnpmfile',
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false',
      ])
      expect(result.stderr).toContain('"action":"reconcile"')
      expect(result.stderr).toContain('"reason":"workspace-links-stale-after-rebuild"')
      expect(result.stderr.match(/"event":"pnpm-install-persistent-provenance"/g)).toHaveLength(1)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('emits a structured non-secret persistent provenance diagnostic for every transition', async () => {
    const fixture = await makeFixture()
    try {
      const result = await runInstaller(fixture)
      expect(result.stderr).toContain('"event":"pnpm-install-persistent-provenance"')
      expect(result.stderr).toContain('"lastInvocationInstallScripts":null')
      expect(result.stderr).toContain('"nativeBinariesMatchRuntime":true')
      expect(result.stderr).toContain('"reason":"missing-stamp"')
      expect(result.stderr).not.toContain('pnpm-lock.yaml')
      expect(result.stderr).not.toContain(fixture.root)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('requires an enabled reconciliation after a script-disabled native repair', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
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
      await writeFile(join(fixture.root, 'node_modules', '.modules.yaml'), 'ignoredBuilds: []\n')
      fixture.env.PNPM_NATIVE_ADDON = addon
      fixture.env.PNPM_REPAIR_NATIVE = '1'
      await resetInstallCalls(fixture)
      await runInstaller(fixture, { installScripts: false })
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --force --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
      ])
      await resetInstallCalls(fixture)
      const result = await runInstaller(fixture)
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
        'rebuild --pending --recursive',
      ])
      expect(result.stderr).toContain('"action":"upgrade-scripts"')
      expect(result.stderr).toContain('"reason":"pending-scripts-rebuild"')
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('reconciles a populated tree with a missing metadata stamp and reports one final diagnostic', async () => {
    const fixture = await makeFixture()
    try {
      await mkdir(join(fixture.root, 'node_modules'), { recursive: true })
      const result = await runInstaller(fixture)
      expect(result.stderr).toContain('"action":"reconcile"')
      expect(result.stderr).toContain('"reason":"missing-stamp-populated-tree"')
      expect(result.stderr.match(/"event":"pnpm-install-persistent-provenance"/g)).toHaveLength(1)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('reconciles an unsafe metadata stamp and reports the unsafe transition', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      await writeFile(
        join(fixture.root, 'node_modules', '.pnpm-install-metadata-health.json'),
        'null\n',
      )
      const result = await runInstaller(fixture)
      expect(result.stderr).toContain('"action":"reconcile"')
      expect(result.stderr).toContain('"reason":"unsafe-stamp"')
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })

  it('requires an enabled reconciliation after a script-disabled workspace-link repair', async () => {
    const fixture = await makeFixture()
    try {
      await runInstaller(fixture)
      await rm(fixture.dependencyLink)
      fixture.env.PNPM_REPAIR_LINK = '1'
      await runInstaller(fixture, { installScripts: false })
      await resetInstallCalls(fixture)
      const result = await runInstaller(fixture)
      await expect(installCalls(fixture)).resolves.toEqual([
        'install --frozen-lockfile --prefer-offline --prod=false --config.disallow-workspace-cycles=false --ignore-scripts',
        'rebuild --pending --recursive',
      ])
      expect(result.stderr).toContain('"action":"upgrade-scripts"')
      expect(result.stderr).toContain('"reason":"pending-scripts-rebuild"')
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })
})
