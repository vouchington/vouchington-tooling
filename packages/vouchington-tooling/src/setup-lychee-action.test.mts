import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
    expect(source).toContain("asset='lychee-{platform}.tar.gz'")
    expect(source).toContain('lychee-lychee-v{version}-{platform}.tar.gz')
    expect(source).toContain('--asset "$asset"')
    expect(source).toContain("--tag-prefix 'lychee-v'")
    expect(source).toContain('--bin lychee')
    expect(source).toContain('--bin-dir "$LYCHEE_BIN_DIR"')
    expect(source).not.toMatch(/voucha|filament|storybook/iu)
    expect(source).toContain('setup-lychee supports Linux and macOS runners')
  })

  it('rejects Windows before downloading a release', () => {
    const directory = mkdtempSync(join(tmpdir(), 'setup-lychee-windows-'))
    const bin = join(directory, 'bin')
    const log = join(directory, 'log')
    mkdirSync(bin)
    writeFileSync(join(bin, 'uname'), "#!/bin/bash\nprintf '%s\\n' Windows\n")
    writeFileSync(
      join(bin, 'install-github-release.sh'),
      '#!/bin/bash\nprintf \'%s\\n\' "$*" > "$INSTALL_LOG"\n',
    )
    chmodSync(join(bin, 'uname'), 0o755)
    chmodSync(join(bin, 'install-github-release.sh'), 0o755)
    writeFileSync(log, '')
    try {
      const result = spawnSync(
        'bash',
        ['--noprofile', '--norc', '-eo', 'pipefail', '-c', action.runs.steps[0]?.run ?? ''],
        {
          encoding: 'utf8',
          env: {
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            LYCHEE_VERSION: '0.24.2',
            INSTALL_GITHUB_RELEASE: join(bin, 'install-github-release.sh'),
            INSTALL_LOG: log,
            GITHUB_PATH: join(directory, 'path'),
            RUNNER_TEMP: directory,
          },
        },
      )
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('Linux and macOS')
      expect(readFileSync(log, 'utf8')).toBe('')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('installs lychee into a per-job bin directory', () => {
    expect(source).toContain('LYCHEE_BIN_DIR="${RUNNER_TEMP:-$HOME/.local}/bin"')
    expect(source).toContain('echo "$LYCHEE_BIN_DIR" >> "$GITHUB_PATH"')
    expect(source).not.toContain('mkdir -p ~/.local/bin')
    expect(source).not.toContain('echo "$HOME/.local/bin" >> "$GITHUB_PATH"')
    expect(source).not.toContain('/tmp/lychee.tar.gz')
  })

  it('selects the checksummed archive for 0.24.0 and later', () => {
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
      const rejected = run('0.23.0')
      expect(rejected.status).toBe(1)
      expect(rejected.stdout).toContain('older releases have no checksum file')
      expect(existsSync(log)).toBe(false)
      expect(run('0.24.0').status).toBe(0)
      expect(readFileSync(log, 'utf8')).toContain(
        '--asset lychee-lychee-v{version}-{platform}.tar.gz',
      )
      expect(readFileSync(log, 'utf8')).toContain('--strip-components 1')
      expect(run('0.24.2').status).toBe(0)
      expect(readFileSync(log, 'utf8')).toContain('--asset lychee-{platform}.tar.gz')
      expect(readFileSync(log, 'utf8')).toContain('--strip-components 1')
      expect(source).not.toContain('--no-checksum')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
