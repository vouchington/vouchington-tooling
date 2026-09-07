import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/install-playwright-chromium-arm64.sh',
)
const temporaryDirectories: string[] = []

const fakeCurl = `#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    shift
    : > "$1"
  fi
  shift
done
printf '200'
`

const fakeUnzip = `#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-d" ]; then
    shift
    destination="$1"
  fi
  shift
done
case "$destination" in
  *chromium_headless_shell*) relative="$FAKE_HEADLESS_PATH" ;;
  *) relative="$FAKE_CHROMIUM_PATH" ;;
esac
mkdir -p "$(dirname "$destination/$relative")"
: > "$destination/$relative"
chmod +x "$destination/$relative"
`

function runInstall(paths: { chromium: string; headlessShell: string }, staleMarker = false) {
  const root = mkdtempSync(join(tmpdir(), 'pw-browsers-install-'))
  temporaryDirectories.push(root)
  const cache = join(root, 'cache')
  const browsersJson = join(root, 'browsers.json')
  writeFileSync(
    browsersJson,
    JSON.stringify({
      browsers: [
        { name: 'chromium', revision: '123' },
        { name: 'chromium-headless-shell', revision: '456' },
      ],
    }),
  )
  if (staleMarker) {
    const staleDirectory = join(cache, 'chromium-123')
    mkdirSync(staleDirectory, { recursive: true })
    writeFileSync(join(staleDirectory, 'INSTALLATION_COMPLETE'), '')
  }
  const fakeBin = join(root, 'bin')
  mkdirSync(fakeBin)
  writeFileSync(join(fakeBin, 'curl'), fakeCurl)
  writeFileSync(join(fakeBin, 'unzip'), fakeUnzip)
  chmodSync(join(fakeBin, 'curl'), 0o755)
  chmodSync(join(fakeBin, 'unzip'), 0o755)

  const result = spawnSync('bash', [script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FAKE_CHROMIUM_PATH: paths.chromium,
      FAKE_HEADLESS_PATH: paths.headlessShell,
      HOME: root,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      PLAYWRIGHT_BROWSERS_JSON: browsersJson,
      PLAYWRIGHT_BROWSERS_PATH: cache,
      RUNNER_TEMP: root,
    },
  })
  return { cache, result }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('install-playwright-chromium-arm64', () => {
  it.each([
    {
      label: 'current Playwright ARM64',
      paths: {
        chromium: 'chrome-linux-arm64/chrome',
        headlessShell: 'chrome-headless-shell-linux-arm64/chrome-headless-shell',
      },
    },
    {
      label: 'legacy Playwright ARM64',
      paths: {
        chromium: 'chrome-linux/chrome',
        headlessShell: 'chrome-linux/headless_shell',
      },
    },
  ])('installs the $label archive layout', ({ paths }) => {
    const { cache, result } = runInstall(paths)

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
    expect(existsSync(join(cache, 'chromium-123', 'INSTALLATION_COMPLETE'))).toBe(true)
    expect(existsSync(join(cache, 'chromium_headless_shell-456', 'INSTALLATION_COMPLETE'))).toBe(
      true,
    )
  })

  it('reinstalls a marker-only cache entry whose executable is missing', () => {
    const { result } = runInstall(
      {
        chromium: 'chrome-linux-arm64/chrome',
        headlessShell: 'chrome-headless-shell-linux-arm64/chrome-headless-shell',
      },
      true,
    )

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('chromium-123 (cache hit)')
  })

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

  it('skips download when the installation marker and executable exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'pw-browsers-hit-'))
    temporaryDirectories.push(root)
    const cache = join(root, 'cache')
    const dir = join(cache, 'chromium-123')
    const executable = join(dir, 'chrome-linux', 'chrome')
    mkdirSync(join(dir, 'chrome-linux'), { recursive: true })
    writeFileSync(join(dir, 'INSTALLATION_COMPLETE'), '')
    writeFileSync(executable, '')
    chmodSync(executable, 0o755)
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
