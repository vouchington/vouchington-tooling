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

type Step = {
  name?: string
  run?: string
  uses?: string
  if?: string
  env?: Record<string, string>
  with?: Record<string, string>
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const actionPath = join(repoRoot, '.github/actions/setup-playwright/action.yml')
const actionSource = readFileSync(actionPath, 'utf8')
const action = parse(actionSource) as {
  inputs: Record<string, { default?: string }>
  runs: { using: string; steps: Step[] }
}

function step(name: string): Step {
  const found = action.runs.steps.find((candidate) => candidate.name === name)
  if (!found?.run) throw new Error(`setup-playwright has no run step named "${name}"`)
  return found
}

function runStep(
  name: string,
  statuses: { node?: number[]; python3?: number[]; browser?: string } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'setup-playwright-'))
  const bin = join(directory, 'bin')
  const workspace = join(directory, 'workspace')
  const log = join(directory, 'log')
  mkdirSync(bin)
  mkdirSync(workspace)
  writeFileSync(log, '')
  const fake = (command: string, queue: number[] = []) => {
    writeFileSync(join(directory, `${command}.queue`), `${queue.map(String).join('\n')}\n`)
    writeFileSync(
      join(bin, command),
      `#!/bin/bash
printf '%s\\n' "${command} $*" >> "$FAKE_LOG"
queue="${join(directory, `${command}.queue`)}"
next="$(head -n 1 "$queue")"
tail -n +2 "$queue" > "$queue.rest" && mv "$queue.rest" "$queue"
exit "\${next:-0}"
`,
    )
    chmodSync(join(bin, command), 0o755)
  }
  fake('node', statuses.node)
  fake('python3', statuses.python3)
  fake('pnpm')
  const waitForApt = join(workspace, 'wait-for-apt-locks.sh')
  writeFileSync(waitForApt, '#!/bin/bash\nprintf "wait-for-apt-locks\\n" >> "$FAKE_LOG"\n')
  chmodSync(waitForApt, 0o755)
  try {
    const result = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step(name).run ?? ''],
      {
        encoding: 'utf8',
        env: {
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          FAKE_LOG: log,
          RUN_BOUNDED: join(workspace, 'run-bounded.py'),
          CHROMIUM_LAUNCH_PROBE: join(workspace, 'chromium-launch-probe.mjs'),
          WAIT_FOR_APT_LOCKS: waitForApt,
          PLAYWRIGHT_BROWSER: statuses.browser ?? 'chromium',
          PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS: '120',
          PLAYWRIGHT_INSTALL_ATTEMPTS: '2',
        },
      },
    )
    const calls = readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((call) => call.replaceAll(workspace, '$WS'))
    return { status: result.status, calls }
  } finally {
    rmSync(directory, { recursive: true })
  }
}

describe('setup-playwright composite action', () => {
  it('exposes the browser, cache path, and download bound as inputs', () => {
    expect(action.runs.using).toBe('composite')
    expect(action.inputs.browser?.default).toBe('chromium')
    expect(action.inputs['cache-path']?.default).toBe('~/.cache/ms-playwright')
    expect(action.inputs['timeout-seconds']?.default).toBe('120')
    expect(action.inputs.attempts?.default).toBe('2')
    expect(actionSource).not.toMatch(/voucha|filament|storybook/iu)
    expect(actionSource).not.toContain('with-host-lock.sh')
    expect(actionSource).not.toContain('ubicloud')
  })

  it('caches the input path with no restore-keys fallback', () => {
    const cache = action.runs.steps.find(
      (candidate) => candidate.name === 'Cache Playwright browsers',
    )
    expect(cache?.uses).toBe('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9')
    expect(cache?.with).toEqual({
      path: '${{ steps.playwright-cache-key.outputs.cache-path }}',
      key: 'playwright-browsers-${{ runner.os }}-${{ runner.arch }}-${{ inputs.browser }}-${{ steps.playwright-cache-key.outputs.lockfile-hash }}',
    })
    expect(cache?.if).toContain(',chrome,')
    expect(cache?.if).toContain(',msedge,')
    expect(cache?.if).toContain("format(',{0},', inputs.browser)")
    expect(step('Resolve Playwright cache key').run).toContain('PLAYWRIGHT_BROWSERS_PATH=$resolved')
    expect(step('Resolve Playwright cache key').run).toContain('sha256sum pnpm-lock.yaml')
    expect(step('Resolve Playwright cache key').run).toContain('shasum -a 256 pnpm-lock.yaml')
  })

  it('points the download and the launch probe at this repository', () => {
    const scripts = 'packages/vouchington-tooling/scripts'
    expect(step('Install Playwright browsers').env?.RUN_BOUNDED).toContain(
      `${scripts}/run-bounded.py`,
    )
    expect(step('Verify Chromium launches').env?.CHROMIUM_LAUNCH_PROBE).toContain(
      `${scripts}/chromium-launch-probe.mjs`,
    )
    expect(step('Verify Chromium launches').env?.WAIT_FOR_APT_LOCKS).toContain(
      'scripts/gha/wait-for-apt-locks.sh',
    )
    expect(existsSync(join(repoRoot, scripts, 'run-bounded.py'))).toBe(true)
    expect(existsSync(join(repoRoot, scripts, 'run_bounded_process.py'))).toBe(true)
    expect(existsSync(join(repoRoot, scripts, 'chromium-launch-probe.mjs'))).toBe(true)
  })
})

describe('setup-playwright browser download', () => {
  it('installs Chrome outside the bounded download', () => {
    const { status, calls } = runStep('Install Playwright browsers', { browser: 'chrome' })

    expect(status).toBe(0)
    expect(calls).toEqual(['pnpm exec playwright install chrome'])
  })

  it('downloads Chromium under the input bound and never installs host packages', () => {
    const { status, calls } = runStep('Install Playwright browsers')

    expect(status).toBe(0)
    expect(calls).toEqual(['python3 $WS/run-bounded.py 120 pnpm exec playwright install chromium'])
  })

  it('retries one stalled download once', () => {
    const { status, calls } = runStep('Install Playwright browsers', { python3: [124, 0] })

    expect(status).toBe(0)
    expect(calls).toHaveLength(2)
  })

  it('fails with the final status after the second stalled download', () => {
    const { status, calls } = runStep('Install Playwright browsers', { python3: [124, 124] })

    expect(status).toBe(124)
    expect(calls).toHaveLength(2)
  })

  it('rejects a non-numeric timeout before starting a download', () => {
    const result = spawnSync(
      'bash',
      [
        '--noprofile',
        '--norc',
        '-eo',
        'pipefail',
        '-c',
        step('Install Playwright browsers').run ?? '',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          RUN_BOUNDED: 'run-bounded.py',
          PLAYWRIGHT_BROWSER: 'chromium',
          PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS: '2m',
          PLAYWRIGHT_INSTALL_ATTEMPTS: '2',
        },
      },
    )
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('timeout-seconds must be a positive integer')
  })

  it('rejects Windows before installing a browser', () => {
    const directory = mkdtempSync(join(tmpdir(), 'setup-playwright-'))
    const bin = join(directory, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'uname'), "#!/bin/bash\nprintf '%s\\n' Windows\n")
    chmodSync(join(bin, 'uname'), 0o755)
    try {
      const result = spawnSync(
        'bash',
        [
          '--noprofile',
          '--norc',
          '-eo',
          'pipefail',
          '-c',
          step('Install Playwright browsers').run ?? '',
        ],
        {
          encoding: 'utf8',
          env: {
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            RUN_BOUNDED: 'run-bounded.py',
            PLAYWRIGHT_BROWSER: 'chromium',
            PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS: '120',
            PLAYWRIGHT_INSTALL_ATTEMPTS: '2',
          },
        },
      )
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('Linux and macOS')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('expands a literal tilde cache path under HOME', () => {
    const directory = mkdtempSync(join(tmpdir(), 'setup-playwright-cache-'))
    const output = join(directory, 'output')
    const envFile = join(directory, 'env')
    writeFileSync(join(directory, 'pnpm-lock.yaml'), 'lock\n')
    try {
      const result = spawnSync(
        'bash',
        [
          '--noprofile',
          '--norc',
          '-eo',
          'pipefail',
          '-c',
          step('Resolve Playwright cache key').run ?? '',
        ],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: '/home/runner',
            PLAYWRIGHT_CACHE_PATH: '~/.cache/ms-playwright',
            GITHUB_OUTPUT: output,
            GITHUB_ENV: envFile,
          },
        },
      )
      expect(result.status).toBe(0)
      expect(readFileSync(envFile, 'utf8')).toBe(
        'PLAYWRIGHT_BROWSERS_PATH=/home/runner/.cache/ms-playwright\n',
      )
      expect(readFileSync(output, 'utf8')).toContain('cache-path=/home/runner/.cache/ms-playwright')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('setup-playwright Chromium launch check', () => {
  const probe = 'node $WS/chromium-launch-probe.mjs'

  it('uses no apt when Chromium launches', () => {
    const { status, calls } = runStep('Verify Chromium launches', { node: [0] })

    expect(status).toBe(0)
    expect(calls).toEqual([probe])
  })

  it('installs host packages, then probes again, when Chromium cannot launch', () => {
    const { status, calls } = runStep('Verify Chromium launches', { node: [1, 0] })

    expect(status).toBe(0)
    expect(calls).toEqual([
      probe,
      'wait-for-apt-locks',
      'pnpm exec playwright install-deps chromium',
      probe,
    ])
  })

  it('fails without retrying when Chromium still cannot launch after the host packages', () => {
    const { status, calls } = runStep('Verify Chromium launches', { node: [1, 1] })

    expect(status).not.toBe(0)
    expect(calls.filter((call) => call.includes('install-deps'))).toHaveLength(1)
    expect(calls.filter((call) => call === probe)).toHaveLength(2)
  })

  it('keeps the apt fallback out of run-bounded', () => {
    const { calls } = runStep('Verify Chromium launches', { node: [1, 0] })

    expect(calls.some((call) => call.startsWith('python3'))).toBe(false)
  })
})
