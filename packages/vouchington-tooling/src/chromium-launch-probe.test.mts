import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { chromiumLaunchProbeExitCode } from '../scripts/chromium-launch-probe.mjs'

const probeSource = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  'scripts/chromium-launch-probe.mjs',
)

describe('chromiumLaunchProbeExitCode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('closes every browser it launched and reports success', async () => {
    const closeFirst = vi.fn<() => Promise<void>>().mockResolvedValue()
    const closeSecond = vi.fn<() => Promise<void>>().mockResolvedValue()

    await expect(
      chromiumLaunchProbeExitCode([
        async () => ({ close: closeFirst }),
        async () => ({ close: closeSecond }),
      ]),
    ).resolves.toBe(0)
    expect(closeFirst).toHaveBeenCalledOnce()
    expect(closeSecond).toHaveBeenCalledOnce()
  })

  it('reports failure and the cause when Chromium cannot launch', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    const exitCode = await chromiumLaunchProbeExitCode([
      async () => {
        throw new Error('missing shared library')
      },
    ])

    expect(exitCode).toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('missing shared library'))
  })

  it('reports failure when a later launch fails after an earlier one succeeded', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const close = vi.fn<() => Promise<void>>().mockResolvedValue()

    const exitCode = await chromiumLaunchProbeExitCode([
      async () => ({ close }),
      async () => {
        throw new Error('full chromium cannot start')
      },
    ])

    expect(exitCode).toBe(1)
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports failure when a launched browser cannot close', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const close = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('already gone'))

    await expect(chromiumLaunchProbeExitCode([async () => ({ close })])).resolves.toBe(1)
  })
})

// Runs a copy of the real entrypoint beside a fake `playwright` package, so the exit status is the
// one the workflow step sees without downloading or starting a browser. The fake appends one line
// per launch (the JSON launch options) and one per close to a `calls` file next to itself.
function runProbe(
  fakePlaywright?: string,
  env?: Record<string, string>,
  packageName = 'playwright',
) {
  const directory = mkdtempSync(join(tmpdir(), 'chromium-launch-probe-'))
  const script = join(directory, 'ci/playwright/chromium-launch-probe.mjs')
  const packageDirectory = join(directory, 'node_modules', packageName)
  mkdirSync(join(directory, 'ci/playwright'), { recursive: true })
  writeFileSync(join(directory, 'package.json'), '{"name":"probe-fixture"}')
  cpSync(probeSource, script)
  if (fakePlaywright !== undefined) {
    mkdirSync(packageDirectory, { recursive: true })
    writeFileSync(
      join(packageDirectory, 'package.json'),
      JSON.stringify({ name: packageName, main: 'index.js' }),
    )
    writeFileSync(join(packageDirectory, 'index.js'), fakePlaywright)
  }
  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_WORKSPACE: directory, ...env },
    })
    let calls: string[] = []
    try {
      calls = readFileSync(join(packageDirectory, 'calls'), 'utf8').split('\n').filter(Boolean)
    } catch {
      // The fake never ran, so nothing was recorded.
    }
    return { ...result, calls }
  } finally {
    rmSync(directory, { recursive: true })
  }
}

const recordingChromium = (failOnChannel?: string) => `
  const { appendFileSync } = require('node:fs')
  const record = line => appendFileSync(__dirname + '/calls', line + '\\n')
  exports.chromium = {
    launch: async (options = {}) => {
      record('launch ' + JSON.stringify(options))
      if (${JSON.stringify(failOnChannel ?? null)} === (options.channel ?? 'default')) {
        throw new Error('missing shared library')
      }
      return { close: async () => record('close') }
    },
  }
`

describe('chromium-launch-probe.mjs process contract', () => {
  it('exits 0 after launching and closing both Chromium flavors', () => {
    const result = runProbe(recordingChromium())

    expect(result.status).toBe(0)
    expect(result.calls).toEqual(['launch {}', 'close', 'launch {"channel":"chromium"}', 'close'])
  })

  it('exits non-zero and names the cause when the headless shell cannot launch', () => {
    const result = runProbe(recordingChromium('default'))

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('missing shared library')
  })

  it('exits non-zero when only full Chromium cannot launch', () => {
    const result = runProbe(recordingChromium('chromium'))

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('missing shared library')
  })

  it('launches Chrome and Edge through the Chromium channel', () => {
    for (const browser of ['chrome', 'msedge']) {
      const result = runProbe(recordingChromium(), { PLAYWRIGHT_BROWSER: browser })

      expect(result.status).toBe(0)
      expect(result.calls).toEqual([`launch {"channel":"${browser}"}`, 'close'])
    }
  })

  it('names a browser Playwright does not export', () => {
    const result = runProbe(recordingChromium(), { PLAYWRIGHT_BROWSER: 'opera' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Playwright has no browser opera')
  })

  it('launches the requested browser once when it is not Chromium', () => {
    const result = runProbe(
      `
        const { appendFileSync } = require('node:fs')
        const record = line => appendFileSync(__dirname + '/calls', line + '\\n')
        exports.firefox = {
          launch: async () => {
            record('firefox')
            return { close: async () => record('close') }
          },
        }
      `,
      { PLAYWRIGHT_BROWSER: 'firefox' },
    )

    expect(result.status).toBe(0)
    expect(result.calls).toEqual(['firefox', 'close'])
  })

  it('loads Chromium from @playwright/test when playwright is not installed', () => {
    const result = runProbe(recordingChromium(), undefined, '@playwright/test')

    expect(result.status).toBe(0)
    expect(result.calls).toEqual(['launch {}', 'close', 'launch {"channel":"chromium"}', 'close'])
  })

  it('exits non-zero when Playwright cannot be resolved', () => {
    const result = runProbe()

    expect(result.status).not.toBe(0)
  })
})
