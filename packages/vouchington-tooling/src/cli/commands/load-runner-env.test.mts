import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = join(process.cwd(), 'packages/vouchington-tooling/scripts/gha/load-runner-env.sh')
const temporaryDirectories: string[] = []

function runHelper(
  options: {
    envFile?: string
    extraEnv?: NodeJS.ProcessEnv
    homeFile?: string
    useRunnerEnvFile?: boolean
  } = {},
) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'load-runner-env-'))
  temporaryDirectories.push(temporaryDirectory)
  const githubEnv = join(temporaryDirectory, 'github-env')
  const home = join(temporaryDirectory, 'home')
  mkdirSync(home)
  writeFileSync(githubEnv, '')
  const envFilePath = options.useRunnerEnvFile
    ? join(temporaryDirectory, 'runner.env')
    : join(home, '.github-actions.env')
  if (options.envFile !== undefined) writeFileSync(envFilePath, options.envFile)
  if (options.homeFile !== undefined)
    writeFileSync(join(home, '.github-actions.env'), options.homeFile)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_ENV: githubEnv,
    HOME: home,
    ...options.extraEnv,
  }
  if (options.useRunnerEnvFile && options.envFile !== undefined) env.RUNNER_ENV_FILE = envFilePath
  const result = spawnSync('bash', [script], { encoding: 'utf8', env })
  return {
    ...result,
    githubEnv: readFileSync(githubEnv, 'utf8'),
  }
}

describe('load-runner-env', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('does not write NODE_OPTIONS through GITHUB_ENV', () => {
    const result = runHelper({ envFile: 'NODE_OPTIONS=--require=/tmp/evil.js\nSAFE=1\n' })
    expect(result.status).toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing to load NODE_OPTIONS')
    expect(result.githubEnv).not.toContain('NODE_OPTIONS')
    expect(result.githubEnv).toContain('SAFE=1')
  })

  it('blocks shell-hijack and loader-hijack variables from GITHUB_ENV', () => {
    const result = runHelper({
      envFile: [
        'BASH_ENV=/tmp/hijack',
        'ENV=/tmp/hijack',
        'PATH=/tmp/evil',
        'LD_PRELOAD=/tmp/evil.so',
        'DYLD_INSERT_LIBRARIES=/tmp/evil.dylib',
        'GIT_DIR=/tmp/evil.git',
        'AWS_SECRET_ACCESS_KEY=secret',
        'KEEP=ok',
      ].join('\n'),
    })
    expect(result.status).toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain(
      'can hijack shell startup, the dynamic loader, PATH, or git',
    )
    expect(`${result.stdout}${result.stderr}`).toContain(
      'AWS credentials must come from aws-actions/configure-aws-credentials',
    )
    expect(result.githubEnv).toBe('KEEP=ok\n')
  })

  it('skips comments, export prefixes, and invalid keys, and no-ops when the file is missing', () => {
    const missing = runHelper()
    expect(missing.status).toBe(0)
    expect(missing.githubEnv).toBe('')
    const result = runHelper({
      envFile: ['# comment', '', 'export VISIBLE=1', '1INVALID=nope', 'ALSO_OK=yes'].join('\n'),
    })
    expect(result.githubEnv).toContain('VISIBLE=1')
    expect(result.githubEnv).toContain('ALSO_OK=yes')
    expect(result.githubEnv).not.toContain('INVALID')
  })

  it('routes named worker variables through validation and prefers the env file', () => {
    const result = runHelper({
      envFile: 'VITEST_MAX_WORKERS=8\nPLAYWRIGHT_MAX_WORKERS=nope\n',
      extraEnv: {
        WORKER_VAR_NAMES: 'VITEST_MAX_WORKERS PLAYWRIGHT_MAX_WORKERS',
        INPUT_VITEST_MAX_WORKERS: '2',
        INPUT_PLAYWRIGHT_MAX_WORKERS: '50%',
      },
    })
    expect(result.status).toBe(0)
    expect(result.githubEnv).toContain('VITEST_MAX_WORKERS=2')
    expect(result.githubEnv).toContain('VITEST_MAX_WORKERS=8')
    expect(result.githubEnv).toContain('PLAYWRIGHT_MAX_WORKERS=50%')
    expect(`${result.stdout}${result.stderr}`).toContain("PLAYWRIGHT_MAX_WORKERS='nope'")
    expect(result.githubEnv).not.toMatch(/PLAYWRIGHT_MAX_WORKERS=nope/)
  })

  it('does not apply worker validation when WORKER_VAR_NAMES is empty', () => {
    const result = runHelper({ envFile: 'VITEST_MAX_WORKERS=nope\n' })
    expect(result.githubEnv).toBe('VITEST_MAX_WORKERS=nope\n')
  })

  it('reads RUNNER_ENV_FILE when set and requires GITHUB_ENV', () => {
    const result = runHelper({
      envFile: 'FROM_FILE=1\n',
      homeFile: 'FROM_HOME=1\n',
      useRunnerEnvFile: true,
    })
    expect(result.githubEnv).toBe('FROM_FILE=1\n')
    const missing = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ENV: '', HOME: tmpdir() },
    })
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('GITHUB_ENV must be set')
  })
})
