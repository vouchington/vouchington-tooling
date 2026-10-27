import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const script = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../scripts/resolve-playwright-version.mjs',
)

function resolveVersion(lockfile: string) {
  const directory = mkdtempSync(join(tmpdir(), 'playwright-version-'))
  const lockfilePath = join(directory, 'pnpm-lock.yaml')
  writeFileSync(lockfilePath, lockfile)
  try {
    return spawnSync(process.execPath, [script, lockfilePath], { encoding: 'utf8' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('resolve-playwright-version', () => {
  it('returns the only numeric playwright-core version', () => {
    const result = resolveVersion(`lockfileVersion: '9.0'

packages:

  playwright-core@1.64.1:
    resolution: {integrity: sha512-abc}

  playwright-core@1.64.1: {}
  'playwright-core@1.64.1(playwright@1.64.1)': {}
`)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('1.64.1\n')
  })

  it('rejects a lockfile with two playwright-core versions', () => {
    const result = resolveVersion(`lockfileVersion: '9.0'

packages:

  playwright-core@1.64.1:
    resolution: {integrity: sha512-abc}

  playwright-core@1.63.0:
    resolution: {integrity: sha512-def}
`)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('found 2')
  })

  it('rejects a lockfile with no playwright-core package', () => {
    const result = resolveVersion("lockfileVersion: '9.0'\n\npackages: {}\n")

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('found 0')
  })

  it('rejects a non-numeric playwright-core version', () => {
    const result = resolveVersion(`lockfileVersion: '9.0'

packages:

  playwright-core@1.64.1-beta.1:
    resolution: {integrity: sha512-abc}
`)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('not numeric x.y.z')
  })

  it('rejects a lockfile that is not version 9', () => {
    const result = resolveVersion("lockfileVersion: '6.0'\n")

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('lockfileVersion 9')
  })

  it('rejects a missing lockfile', () => {
    const result = spawnSync(process.execPath, [script, '/tmp/missing-pnpm-lock.yaml'], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('cannot read')
  })
})
