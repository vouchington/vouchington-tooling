import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = readFileSync(join(repoRoot, '.github/actions/setup-lychee/action.yml'), 'utf8')
const action = parse(source) as {
  inputs: Record<string, { default?: string }>
  runs: { using: string; steps: { env?: Record<string, string>; run?: string }[] }
}

describe('setup-lychee action', () => {
  it('installs the requested lychee release through install-github-release', () => {
    expect(action.runs.using).toBe('composite')
    expect(action.inputs.version?.default).toBe('0.24.2')
    expect(action.runs.steps[0]?.env?.LYCHEE_VERSION).toBe('${{ inputs.version }}')
    expect(action.runs.steps[0]?.env?.INSTALL_GITHUB_RELEASE).toContain(
      'packages/vouchington-tooling/scripts/gha/install-github-release.sh',
    )
    expect(source).toContain('--repo lycheeverse/lychee')
    expect(source).toContain("--asset 'lychee-{platform}.tar.gz'")
    expect(source).toContain("--tag-prefix 'lychee-v'")
    expect(source).toContain('--bin lychee')
    expect(source).toContain('--bin-dir "$LYCHEE_BIN_DIR"')
    expect(source).not.toMatch(/voucha|filament|storybook/iu)
  })

  it('installs lychee into a per-job bin directory', () => {
    expect(source).toContain('LYCHEE_BIN_DIR="${RUNNER_TEMP:-$HOME/.local}/bin"')
    expect(source).toContain('echo "$LYCHEE_BIN_DIR" >> "$GITHUB_PATH"')
    expect(source).not.toContain('mkdir -p ~/.local/bin')
    expect(source).not.toContain('echo "$HOME/.local/bin" >> "$GITHUB_PATH"')
    expect(source).not.toContain('/tmp/lychee.tar.gz')
  })

  it('strips no components for archives before 0.24.0', () => {
    const directory = mkdtempSync(join(tmpdir(), 'setup-lychee-'))
    const bin = join(directory, 'bin')
    const log = join(directory, 'log')
    mkdirSync(bin)
    writeFileSync(
      join(bin, 'install-github-release.sh'),
      `#!/bin/bash
printf '%s\\n' "$*" > "$INSTALL_LOG"
`,
    )
    chmodSync(join(bin, 'install-github-release.sh'), 0o755)
    const run = (version: string) =>
      spawnSync(
        'bash',
        ['--noprofile', '--norc', '-eo', 'pipefail', '-c', action.runs.steps[0]?.run ?? ''],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            LYCHEE_VERSION: version,
            INSTALL_GITHUB_RELEASE: join(bin, 'install-github-release.sh'),
            INSTALL_LOG: log,
            GITHUB_PATH: join(directory, 'path'),
            RUNNER_TEMP: directory,
          },
        },
      )
    try {
      expect(run('0.23.0').status).toBe(0)
      expect(readFileSync(log, 'utf8')).toContain('--strip-components 0')
      expect(run('0.24.2').status).toBe(0)
      expect(readFileSync(log, 'utf8')).toContain('--strip-components 1')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
