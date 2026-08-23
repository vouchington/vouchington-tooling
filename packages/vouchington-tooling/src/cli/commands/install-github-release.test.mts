import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/install-github-release.sh',
)
const temporaryDirectories: string[] = []

function runHelper(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'install-github-release-'))
  temporaryDirectories.push(temporaryDirectory)
  const fakeBin = join(temporaryDirectory, 'path')
  mkdirSync(fakeBin)
  writeFileSync(join(fakeBin, 'curl'), '#!/bin/sh\necho "curl should not run" >&2\nexit 99\n')
  chmodSync(join(fakeBin, 'curl'), 0o755)
  const githubPath = join(temporaryDirectory, 'github-path')
  writeFileSync(githubPath, '')
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_PATH: githubPath,
      PATH: fakeBin + delimiter + (process.env['PATH'] ?? ''),
      RUNNER_TEMP: temporaryDirectory,
      ...extraEnv,
    },
  })
  return { ...result, githubPath, temporaryDirectory }
}

describe('install-github-release', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('rejects missing and malformed arguments', () => {
    const required = [
      '--version',
      '0.24.2',
      '--asset',
      'lychee-{platform}.tar.gz',
      '--bin',
      'lychee',
    ]
    expect(runHelper([]).status).toBe(2)
    expect(runHelper(['--repo']).stderr).toContain('usage:')
    expect(runHelper(['--repo', 'only-owner', ...required]).stderr).toContain('owner/name')
    expect(
      runHelper(['--repo', 'lycheeverse/lychee', ...required, '--strip-components', 'nope']).stderr,
    ).toContain('non-negative integer')
    expect(runHelper(['--unknown']).status).toBe(2)
  })

  it('accepts installer flags used by lychee, gitleaks, and opencode', () => {
    expect(runHelper(['--repo']).status).toBe(2)
    const skipped = runHelper(
      [
        '--repo',
        'gitleaks/gitleaks',
        '--version',
        '8.30.1',
        '--asset',
        'gitleaks_{version}_{platform}.tar.gz',
        '--bin',
        'gitleaks',
        '--version-flag',
        'version',
        '--checksums-asset',
        'gitleaks_{version}_checksums.txt',
        '--bin-dir',
        '/tmp/unused-bin',
        '--no-checksum',
      ],
      {},
    )
    expect(skipped.status).toBe(99)
  })

  it('skips the download when a matching binary is already installed', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'install-github-release-skip-'))
    temporaryDirectories.push(temporaryDirectory)
    mkdirSync(join(temporaryDirectory, 'bin'))
    writeFileSync(join(temporaryDirectory, 'bin', 'lychee'), '#!/bin/sh\necho lychee 0.24.2\n')
    chmodSync(join(temporaryDirectory, 'bin', 'lychee'), 0o755)
    const skipped = runHelper(
      [
        '--repo',
        'lycheeverse/lychee',
        '--version',
        '0.24.2',
        '--asset',
        'lychee-{platform}.tar.gz',
        '--bin',
        'lychee',
        '--tag-prefix',
        'lychee-v',
      ],
      { RUNNER_TEMP: temporaryDirectory },
    )
    expect(skipped.status).toBe(0)
    expect(skipped.stdout).toContain('lychee 0.24.2 already installed')
    expect(skipped.stderr).not.toContain('curl should not run')
  })

  it('does not treat VERSION metacharacters as a regex match', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'install-github-release-regex-'))
    temporaryDirectories.push(temporaryDirectory)
    mkdirSync(join(temporaryDirectory, 'bin'))
    writeFileSync(join(temporaryDirectory, 'bin', 'lychee'), '#!/bin/sh\necho lychee 0x24x2\n')
    chmodSync(join(temporaryDirectory, 'bin', 'lychee'), 0o755)
    const result = runHelper(
      [
        '--repo',
        'lycheeverse/lychee',
        '--version',
        '0.24.2',
        '--asset',
        'lychee.tar.gz',
        '--bin',
        'lychee',
      ],
      { RUNNER_TEMP: temporaryDirectory },
    )
    expect(result.status).toBe(99)
    expect(result.stderr).toContain('curl should not run')
  })

  it('does not treat a longer version string as already installed', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'install-github-release-prefix-'))
    temporaryDirectories.push(temporaryDirectory)
    mkdirSync(join(temporaryDirectory, 'bin'))
    writeFileSync(join(temporaryDirectory, 'bin', 'lychee'), '#!/bin/sh\necho lychee 0.24.20\n')
    chmodSync(join(temporaryDirectory, 'bin', 'lychee'), 0o755)
    const result = runHelper(
      [
        '--repo',
        'lycheeverse/lychee',
        '--version',
        '0.24.2',
        '--asset',
        'lychee.tar.gz',
        '--bin',
        'lychee',
      ],
      { RUNNER_TEMP: temporaryDirectory },
    )
    expect(result.status).toBe(99)
    expect(result.stderr).toContain('curl should not run')
  })
})
