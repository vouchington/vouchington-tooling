import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { collectPnpmLicenseReport } from './collect.mts'
import type { PnpmExecutor } from './types.mts'
import { preparePnpmLicenseAuditWorkspace, renderPnpmLicenseAuditWorkspace } from './workspace.mts'

type PnpmResult = {
  error?: Error
  status: number | null
  stderr?: string
  stdout?: string
}

function fakeExecutor(result: PnpmResult, fetchResult: PnpmResult = { status: 0 }): PnpmExecutor {
  const steps = [
    {
      args: [
        '--config.store-dir=/audit/.pnpm-store',
        '--config.force=true',
        'fetch',
        '--ignore-scripts',
      ],
      result: fetchResult,
    },
    {
      args: ['--config.store-dir=/audit/.pnpm-store', 'licenses', 'list', '--json'],
      result,
    },
  ]
  return (command, args, options) => {
    const step = steps.shift()
    if (!step) throw new Error(`unexpected pnpm invocation: ${args.join(' ')}`)
    expect(command).toBe('pnpm')
    expect(args).toEqual(step.args)
    expect(options).toEqual({ cwd: '/audit', encoding: 'utf8' })
    return { stderr: '', stdout: '', ...step.result }
  }
}

function collectTestReport(execute: PnpmExecutor, cleanup: () => void = () => undefined) {
  return collectPnpmLicenseReport('/repo', {
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
      return { cwd: '/audit', cleanup }
    },
  })
}

describe('pnpm license collection', () => {
  it('derives every lockfile platform without retaining workspace packages', () => {
    const workspace = parseYaml(
      renderPnpmLicenseAuditWorkspace(
        `packages:\n  example@1.0.0:\n    os: [win32]\n    cpu: arm64\n    libc: [musl]\n`,
        'packages: [app]\nengineStrict: true\n',
        { lockfile: 'pnpm-lock.yaml', workspace: 'pnpm-workspace.yaml' },
      ),
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

  it('rejects malformed platform selectors', () => {
    expect(() =>
      renderPnpmLicenseAuditWorkspace(
        `packages:\n  example@1.0.0:\n    os: 42\n`,
        'packages: []\n',
        {
          lockfile: 'pnpm-lock.yaml',
          workspace: 'pnpm-workspace.yaml',
        },
      ),
    ).toThrow('pnpm-lock.yaml packages.*.os to be a string or an array of strings')
  })

  it.each([
    ['[', 'failed to parse pnpm-lock.yaml'],
    ['- not-an-object\n', 'expected pnpm-lock.yaml to contain a YAML object'],
    ['importers: {}\n', 'expected pnpm-lock.yaml to contain a packages object'],
  ])('rejects malformed lockfile YAML %j', (lockfile, message) => {
    expect(() =>
      renderPnpmLicenseAuditWorkspace(lockfile, 'packages: []\n', {
        lockfile: 'pnpm-lock.yaml',
        workspace: 'pnpm-workspace.yaml',
      }),
    ).toThrow(message)
  })

  it('ignores lockfile snapshots without platform selectors', () => {
    const workspace = parseYaml(
      renderPnpmLicenseAuditWorkspace(
        'packages:\n  scalar: 1\n  ordinary:\n    resolution: {integrity: fixture}\n',
        'packages: []\n',
        { lockfile: 'pnpm-lock.yaml', workspace: 'pnpm-workspace.yaml' },
      ),
    ) as { supportedArchitectures: Record<string, string[]> }
    expect(workspace.supportedArchitectures).toEqual({
      cpu: ['current'],
      libc: ['current'],
      os: ['current'],
    })
  })

  it('prepares a disposable workspace when the repository has no npmrc', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'dependency-license-test-'))
    try {
      writeFileSync(join(repoRoot, 'package.json'), '{}\n')
      writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'packages: {}\n')
      const workspace = preparePnpmLicenseAuditWorkspace(
        repoRoot,
        'packages: {}\n',
        'packages: []\n',
      )
      try {
        expect(existsSync(join(workspace.cwd, 'package.json'))).toBe(true)
        expect(existsSync(join(workspace.cwd, '.npmrc'))).toBe(false)
      } finally {
        workspace.cleanup()
      }
    } finally {
      rmSync(repoRoot, { force: true, recursive: true })
    }
  })

  it('copies a repository npmrc inside the private disposable workspace', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'dependency-license-test-'))
    try {
      writeFileSync(join(repoRoot, 'package.json'), '{}\n')
      writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'packages: {}\n')
      writeFileSync(join(repoRoot, '.npmrc'), 'registry=https://registry.example.test\n')
      const workspace = preparePnpmLicenseAuditWorkspace(
        repoRoot,
        'packages: {}\n',
        'packages: []\n',
      )
      try {
        expect(readFileSync(join(workspace.cwd, '.npmrc'), 'utf8')).toBe(
          'registry=https://registry.example.test\n',
        )
      } finally {
        workspace.cleanup()
      }
    } finally {
      rmSync(repoRoot, { force: true, recursive: true })
    }
  })

  it('removes a partially prepared workspace when a required file is missing', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'dependency-license-test-'))
    try {
      expect(() =>
        preparePnpmLicenseAuditWorkspace(repoRoot, 'packages: {}\n', 'packages: []\n'),
      ).toThrow()
    } finally {
      rmSync(repoRoot, { force: true, recursive: true })
    }
  })

  it('cleans the disposable workspace after success and failure', () => {
    let cleanupCount = 0
    const cleanup = () => {
      cleanupCount += 1
    }
    collectTestReport(fakeExecutor({ status: 0, stdout: '{}' }), cleanup)
    expect(() =>
      collectTestReport(fakeExecutor({ error: new Error('spawn failed'), status: null }), cleanup),
    ).toThrow('spawn failed')
    expect(() =>
      collectTestReport(
        fakeExecutor(
          { status: 0, stdout: '{}' },
          { error: new Error('fetch failed'), status: null },
        ),
        cleanup,
      ),
    ).toThrow('fetch failed')
    expect(cleanupCount).toBe(3)
  })

  it('parses a well-formed report using an isolated forced fetch', () => {
    expect(
      collectTestReport(
        fakeExecutor({
          status: 0,
          stdout: JSON.stringify({ MIT: [{ name: 'example', versions: ['1.0.0'] }] }),
        }),
      ),
    ).toEqual({ MIT: [{ name: 'example', versions: ['1.0.0'] }] })
  })

  it('reads repository files with the default file reader', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'dependency-license-test-'))
    try {
      writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'packages: {}\n')
      writeFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'packages: []\n')
      expect(
        collectPnpmLicenseReport(repoRoot, {
          execute: fakeExecutor({ status: 0, stdout: '{}' }),
          prepareWorkspace: (_root, lockfileSource, workspaceSource) => {
            expect(lockfileSource).toBe('packages: {}\n')
            expect(workspaceSource).toBe('packages: []\n')
            return { cwd: '/audit', cleanup: () => undefined }
          },
        }),
      ).toEqual({})
    } finally {
      rmSync(repoRoot, { force: true, recursive: true })
    }
  })

  it.each([
    [{ status: 1, stderr: 'fetch denied' }, /pnpm fetch.*status 1.*fetch denied/s],
    [{ error: new Error('fetch spawn failed'), status: null }, /fetch spawn failed/],
  ])('reports a failed fetch', (fetchResult, message) => {
    expect(() => collectTestReport(fakeExecutor({ status: 0, stdout: '{}' }, fetchResult))).toThrow(
      message,
    )
  })

  it.each([
    [{ status: 1, stderr: 'license command failed' }, /status 1.*license command failed/s],
    [{ status: 1, stdout: '{"error":"missing index"}' }, /status 1.*missing index/s],
    [{ status: 0, stdout: 'not json' }, /unparseable output/],
  ])('reports invalid license command output', (result, message) => {
    expect(() => collectTestReport(fakeExecutor(result))).toThrow(message)
  })
})
