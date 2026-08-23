import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/install-playwright-chromium-arm64.sh',
)
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('install-playwright-chromium-arm64', () => {
  it('fails when browsers.json is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pw-browsers-'))
    temporaryDirectories.push(root)
    const result = spawnSync('bash', [script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HOME: root, PLAYWRIGHT_BROWSERS_JSON: join(root, 'missing.json') },
    })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain('browsers.json not found')
  })

  it('rejects a malformed browser spec', () => {
    const root = mkdtempSync(join(tmpdir(), 'pw-browsers-spec-'))
    temporaryDirectories.push(root)
    writeFileSync(join(root, 'browsers.json'), JSON.stringify({ browsers: [] }))
    const result = spawnSync('bash', [script, 'chromium'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HOME: root, PLAYWRIGHT_BROWSERS_JSON: join(root, 'browsers.json') },
    })
    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).toContain('name:archive')
  })

  it('skips download when the installation marker exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'pw-browsers-hit-'))
    temporaryDirectories.push(root)
    const cache = join(root, 'cache')
    const dir = join(cache, 'chromium-123')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'INSTALLATION_COMPLETE'), '')
    writeFileSync(
      join(root, 'browsers.json'),
      JSON.stringify({ browsers: [{ name: 'chromium', revision: '123' }] }),
    )
    const fakeBin = join(root, 'bin')
    mkdirSync(fakeBin)
    writeFileSync(join(fakeBin, 'curl'), '#!/bin/sh\necho curl should not run >&2\nexit 99\n')
    chmodSync(join(fakeBin, 'curl'), 0o755)
    const result = spawnSync('bash', [script, 'chromium:chromium-linux-arm64.zip'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: root,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        PLAYWRIGHT_BROWSERS_JSON: join(root, 'browsers.json'),
        PLAYWRIGHT_BROWSERS_PATH: cache,
      },
    })
    expect({
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }).toMatchObject({ status: 0 })
    expect(result.stdout).toContain('cache hit')
  })
})
