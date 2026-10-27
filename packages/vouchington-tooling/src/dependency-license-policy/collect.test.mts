import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { collectPnpmLicenseReport } from './collect.mts'
import type { PnpmExecutor } from './types.mts'
import {
  licenseAuditParentDirectory,
  preparePnpmLicenseAuditWorkspace,
  renderPnpmLicenseAuditFiles,
} from './workspace.mts'

type PnpmResult = {
  error?: Error
  status: number | null
  stderr?: string
  stdout?: string
}

function fakeExecutor(
  result: PnpmResult,
  fetchResult: PnpmResult = { status: 0 },
  storeDir = '/audit/store',
): PnpmExecutor {
  const steps = [
    {
      args: [`--config.store-dir=${storeDir}`, 'fetch', '--ignore-scripts'],
      result: fetchResult,
    },
    {
      args: [`--config.store-dir=${storeDir}`, 'licenses', 'list', '--json'],
      result,
    },
  ]
  return (command, args, options) => {
    const step = steps.shift()
    if (!step) throw new Error(`unexpected pnpm invocation: ${args.join(' ')}`)
    expect(command).toBe('pnpm')
    expect(args).toEqual(step.args)
    expect(options.cwd).toBe('/audit')
    expect(options.encoding).toBe('utf8')
    expect(options.signal.aborted).toBe(false)
    return { stderr: '', stdout: '', ...step.result }
  }
}

function collectTestReport(execute: PnpmExecutor, cleanup: () => void = () => undefined) {
  return collectPnpmLicenseReport('/repo', {
    ensureStore: () => undefined,
    execute,
    readFile: (path) => {
      if (path === '/repo/pnpm-lock.yaml') return 'packages: {}\n'
      expect(path).toBe('/repo/pnpm-workspace.yaml')
      return 'packages: [app]\nengineStrict: true\n'
    },
    prepareWorkspace: (repoRoot, lockfileSource, workspaceSource) => {
      expect(repoRoot).toBe('/repo')
      expect(lockfileSource).toBe('packages: {}\n')
      expect(workspaceSource).toBe('packages: [app]\nengineStrict: true\n')
      return { cwd: '/audit', cleanup, useListingWorkspace: () => undefined }
    },
  })
}

function isolatedDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

const AUDIT_PATHS = { lockfile: 'pnpm-lock.yaml', workspace: 'pnpm-workspace.yaml' }

const ENGINES_GRAPH = [
  'packages:',
  '  engines-only@1.0.0:',
  '    engines: {node: ^999.0.0}',
  '  sharp-win32@1.0.0:',
  '    resolution: {integrity: sha512-fixture}',
  "    engines: {node: '>=999.0.0'}",
  '    os: [win32]',
  '',
].join('\n')

const GRAPH_WITHOUT_ENGINES = {
  packages: {
    'engines-only@1.0.0': {},
    'sharp-win32@1.0.0': { os: ['win32'], resolution: { integrity: 'sha512-fixture' } },
  },
}

function renderAuditWorkspace(lockfile: string, workspace: string) {
  return parseYaml(
    renderPnpmLicenseAuditFiles(lockfile, workspace, AUDIT_PATHS).listingWorkspace,
  ) as {
    supportedArchitectures: Record<string, string[]>
  }
}

describe('pnpm license collection', () => {
  it('defaults the audit parent to the system temp directory', () => {
    expect(licenseAuditParentDirectory()).toBe(tmpdir())
    expect(licenseAuditParentDirectory('/audit-parent')).toBe('/audit-parent')
  })

  it('derives every lockfile platform without retaining workspace packages', () => {
    const workspace = renderAuditWorkspace(
      `packages:\n  example@1.0.0:\n    os: [win32]\n    cpu: arm64\n    libc: [musl]\n`,
      'packages: [app]\nengineStrict: true\n',
    )
    expect(workspace).toEqual({
      engineStrict: true,
      packages: [],
      supportedArchitectures: {
        cpu: ['current', 'arm64'],
        libc: ['current', 'musl'],
        os: ['current', 'win32'],
      },
    })
  })

  it('fetches only the current platform even when the source workspace sets its own', () => {
    const { fetchWorkspace } = renderPnpmLicenseAuditFiles(
      'packages:\n  example@1.0.0:\n    os: [win32]\n',
      'packages: [app]\nsupportedArchitectures: {os: [linux], cpu: [x64]}\n',
      AUDIT_PATHS,
    )
    expect(parseYaml(fetchWorkspace)).toEqual({
      packages: [],
      supportedArchitectures: { cpu: ['current'], libc: ['current'], os: ['current'] },
    })
  })

  it('drops engines from every lockfile package so fetch keeps Node-incompatible optionals', () => {
    const { lockfile } = renderPnpmLicenseAuditFiles(ENGINES_GRAPH, 'packages: []\n', AUDIT_PATHS)
    expect(parseYaml(lockfile)).toEqual(GRAPH_WITHOUT_ENGINES)
  })

  it('rejects malformed platform selectors', () => {
    expect(() =>
      renderPnpmLicenseAuditFiles(
        `packages:\n  example@1.0.0:\n    os: 42\n`,
        'packages: []\n',
        AUDIT_PATHS,
      ),
    ).toThrow('pnpm-lock.yaml packages.*.os to be a string or an array of strings')
  })

  it.each([
    ['[', 'failed to parse pnpm-lock.yaml'],
    ['', 'expected pnpm-lock.yaml to contain a YAML object'],
    ['- not-an-object\n', 'expected pnpm-lock.yaml to contain a YAML object'],
    ['importers: {}\n', 'expected pnpm-lock.yaml to contain a packages object'],
  ])('rejects malformed lockfile YAML %j', (lockfile, message) => {
    expect(() => renderPnpmLicenseAuditFiles(lockfile, 'packages: []\n', AUDIT_PATHS)).toThrow(
      message,
    )
  })

  it('ignores lockfile snapshots without platform selectors', () => {
    const workspace = renderAuditWorkspace(
      'packages:\n  scalar: 1\n  ordinary:\n    resolution: {integrity: fixture}\n',
      'packages: []\n',
    )
    expect(workspace.supportedArchitectures).toEqual({
      cpu: ['current'],
      libc: ['current'],
      os: ['current'],
    })
  })

  it('prepares a disposable workspace when the repository has no npmrc', () => {
    const parent = isolatedDirectory('dependency-license-parent-')
    const repoRoot = isolatedDirectory('dependency-license-test-')
    try {
      writeFileSync(join(repoRoot, 'package.json'), '{}\n')
      const workspace = preparePnpmLicenseAuditWorkspace(
        repoRoot,
        ENGINES_GRAPH,
        'packages: []\n',
        {
          directory: parent,
          pid: 424242,
        },
      )
      try {
        expect(readFileSync(join(workspace.cwd, 'package.json'), 'utf8')).toBe('{}\n')
        expect(existsSync(join(workspace.cwd, '.npmrc'))).toBe(false)
        expect(readFileSync(join(workspace.cwd, 'audit.pid'), 'utf8')).toBe('424242\n')
        expect(lstatSync(join(workspace.cwd, 'audit.pid')).mode & 0o777).toBe(0o600)
        expect(parseYaml(readFileSync(join(workspace.cwd, 'pnpm-lock.yaml'), 'utf8'))).toEqual(
          GRAPH_WITHOUT_ENGINES,
        )
        const workspaceFile = join(workspace.cwd, 'pnpm-workspace.yaml')
        expect(parseYaml(readFileSync(workspaceFile, 'utf8'))).toEqual({
          packages: [],
          supportedArchitectures: { cpu: ['current'], libc: ['current'], os: ['current'] },
        })
        workspace.useListingWorkspace()
        expect(parseYaml(readFileSync(workspaceFile, 'utf8'))).toMatchObject({
          packages: [],
          supportedArchitectures: { os: ['current', 'win32'] },
        })
        workspace.cleanup()
        expect(existsSync(workspace.cwd)).toBe(false)
      } finally {
        workspace.cleanup()
      }
    } finally {
      rmSync(parent, { force: true, recursive: true })
      rmSync(repoRoot, { force: true, recursive: true })
    }
  })

  it('copies a repository npmrc inside the private disposable workspace', () => {
    const parent = isolatedDirectory('dependency-license-parent-')
    const repoRoot = isolatedDirectory('dependency-license-test-')
    try {
      writeFileSync(join(repoRoot, 'package.json'), '{}\n')
      writeFileSync(join(repoRoot, '.npmrc'), 'registry=https://registry.example.test\n')
      const workspace = preparePnpmLicenseAuditWorkspace(
        repoRoot,
        'packages: {}\n',
        'packages: []\n',
        {
          directory: parent,
        },
      )
      try {
        expect(readFileSync(join(workspace.cwd, '.npmrc'), 'utf8')).toBe(
          'registry=https://registry.example.test\n',
        )
        expect(readFileSync(join(workspace.cwd, 'audit.pid'), 'utf8')).toBe(
          `${String(process.pid)}\n`,
        )
      } finally {
        workspace.cleanup()
      }
    } finally {
      rmSync(parent, { force: true, recursive: true })
      rmSync(repoRoot, { force: true, recursive: true })
    }
  })

  it('removes a partially prepared workspace when a required file is missing', () => {
    const parent = isolatedDirectory('dependency-license-parent-')
    const repoRoot = isolatedDirectory('dependency-license-test-')
    try {
      expect(() =>
        preparePnpmLicenseAuditWorkspace(repoRoot, 'packages: {}\n', 'packages: []\n', {
          directory: parent,
        }),
      ).toThrow()
      expect(readdirSync(parent)).toEqual([])
    } finally {
      rmSync(parent, { force: true, recursive: true })
      rmSync(repoRoot, { force: true, recursive: true })
    }
  })

  it('cleans the disposable workspace after success and failure', async () => {
    let cleanupCount = 0
    const cleanup = () => {
      cleanupCount += 1
    }
    await collectTestReport(fakeExecutor({ status: 0, stdout: '{}' }), cleanup)
    await expect(
      collectTestReport(fakeExecutor({ error: new Error('spawn failed'), status: null }), cleanup),
    ).rejects.toThrow('spawn failed')
    await expect(
      collectTestReport(
        fakeExecutor(
          { status: 0, stdout: '{}' },
          { error: new Error('fetch failed'), status: null },
        ),
        cleanup,
      ),
    ).rejects.toThrow('fetch failed')
    expect(cleanupCount).toBe(3)
  })

  it.each([
    ['success', { status: 0, stdout: '{}' }, { status: 0, stdout: '{}' }],
    ['fetch failure', { status: 1, stderr: 'fetch failed' }, { status: 0, stdout: '{}' }],
    ['license failure', { status: 0, stdout: '{}' }, { status: 1, stderr: 'license failed' }],
  ] as const)('removes downloaded store contents after %s', async (outcome, fetch, licenses) => {
    const workspace = isolatedDirectory('dependency-license-audit-')
    const marker = join(workspace, 'store', 'downloaded-package')
    try {
      const collection = collectPnpmLicenseReport('/repo', {
        execute: (_command, args) => {
          if (args[1] === 'fetch') {
            mkdirSync(join(workspace, 'store'), { recursive: true })
            writeFileSync(marker, 'package contents')
            return { stderr: '', stdout: '', ...fetch }
          }
          expect(existsSync(marker)).toBe(true)
          return { stderr: '', stdout: '', ...licenses }
        },
        prepareWorkspace: () => ({
          cwd: workspace,
          cleanup: () => rmSync(workspace, { force: true, recursive: true }),
          useListingWorkspace: () => undefined,
        }),
        readFile: () => 'packages: {}\n',
      })
      if (outcome === 'success') await expect(collection).resolves.toEqual({})
      else {
        const command = outcome === 'fetch failure' ? 'fetch' : 'license'
        await expect(collection).rejects.toThrow(`${command} failed`)
      }
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(workspace, { force: true, recursive: true })
    }
  })

  it('parses a well-formed report using an isolated fetch', async () => {
    await expect(
      collectTestReport(
        fakeExecutor({
          status: 0,
          stdout: JSON.stringify({ MIT: [{ name: 'example', versions: ['1.0.0'] }] }),
        }),
      ),
    ).resolves.toEqual({ MIT: [{ name: 'example', versions: ['1.0.0'] }] })
  })

  it('reads repository files with the default file reader', async () => {
    const repoRoot = isolatedDirectory('dependency-license-test-')
    try {
      writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'packages: {}\n')
      writeFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'packages: []\n')
      await expect(
        collectPnpmLicenseReport(repoRoot, {
          ensureStore: () => undefined,
          execute: fakeExecutor({ status: 0, stdout: '{}' }),
          prepareWorkspace: (_root, lockfileSource, workspaceSource) => {
            expect(lockfileSource).toBe('packages: {}\n')
            expect(workspaceSource).toBe('packages: []\n')
            return { cwd: '/audit', cleanup: () => undefined, useListingWorkspace: () => undefined }
          },
        }),
      ).resolves.toEqual({})
    } finally {
      rmSync(repoRoot, { force: true, recursive: true })
    }
  })

  it('fetches into the private store nested in the disposable workspace', async () => {
    let seen = ''
    await collectPnpmLicenseReport('/repo', {
      ensureStore: (directory) => {
        seen = directory
      },
      execute: (_command, args, options) => {
        expect(args[0]).toBe(`--config.store-dir=${seen}`)
        expect(options.signal.aborted).toBe(false)
        return { status: 0, stderr: '', stdout: '{}' }
      },
      prepareWorkspace: () => ({
        cwd: '/audit',
        cleanup: () => undefined,
        useListingWorkspace: () => undefined,
      }),
      readFile: () => 'packages: {}\n',
    })
    expect(seen).toBe('/audit/store')
  })

  it('gives concurrent audits separate stores', async () => {
    const workspaces = [
      isolatedDirectory('dependency-license-audit-'),
      isolatedDirectory('dependency-license-audit-'),
    ]
    const stores = new Set<string>()
    try {
      await Promise.all(
        workspaces.map((workspace) =>
          collectPnpmLicenseReport('/repo', {
            execute: (_command, args) => {
              stores.add(args[0]?.slice('--config.store-dir='.length) ?? '')
              return { status: 0, stderr: '', stdout: '{}' }
            },
            prepareWorkspace: () => ({
              cwd: workspace,
              cleanup: () => rmSync(workspace, { force: true, recursive: true }),
              useListingWorkspace: () => undefined,
            }),
            readFile: () => 'packages: {}\n',
          }),
        ),
      )
      expect(stores).toEqual(new Set(workspaces.map((workspace) => join(workspace, 'store'))))
    } finally {
      for (const workspace of workspaces) rmSync(workspace, { force: true, recursive: true })
    }
  })

  it('cleans the workspace when store setup fails', async () => {
    let cleaned = false
    await expect(
      collectPnpmLicenseReport('/repo', {
        ensureStore: () => {
          throw new Error('store denied')
        },
        execute: fakeExecutor({ status: 0, stdout: '{}' }),
        prepareWorkspace: () => ({
          cwd: '/audit',
          cleanup: () => {
            cleaned = true
          },
          useListingWorkspace: () => undefined,
        }),
        readFile: () => 'packages: {}\n',
      }),
    ).rejects.toThrow('store denied')
    expect(cleaned).toBe(true)
  })

  it.each([
    [{ status: 1, stderr: 'fetch denied' }, /pnpm fetch.*status 1.*fetch denied/s],
    [{ error: new Error('fetch spawn failed'), status: null }, /fetch spawn failed/],
  ])('reports a failed fetch', async (fetchResult, message) => {
    await expect(
      collectTestReport(fakeExecutor({ status: 0, stdout: '{}' }, fetchResult)),
    ).rejects.toThrow(message)
  })

  it.each([
    [{ status: 1, stderr: 'license command failed' }, /status 1.*license command failed/s],
    [{ status: 1, stdout: '{"error":"missing index"}' }, /status 1.*missing index/s],
    [{ status: 0, stdout: 'not json' }, /unparseable output/],
  ])('reports invalid license command output', async (result, message) => {
    await expect(collectTestReport(fakeExecutor(result))).rejects.toThrow(message)
  })
})
