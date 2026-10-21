#!/usr/bin/env node
// Exit 0 when the selected browser launches and closes cleanly, 1 otherwise.
// Plain JavaScript so a Node 20 runner can execute it. setup-playwright runs this
// before it spends an apt download on playwright install-deps. Chromium also
// launches with channel chromium, because that build can need different host
// libraries than the headless shell. Chrome and Edge are Chromium channels, not
// separate Playwright exports. Any failure counts, and the cause is only printed,
// so the probe never depends on Playwright's error wording.

import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const chromiumChannels = new Set([
  'chrome',
  'chrome-beta',
  'chrome-dev',
  'chrome-canary',
  'msedge',
  'msedge-beta',
  'msedge-dev',
  'msedge-canary',
])

export async function chromiumLaunchProbeExitCode(launches) {
  try {
    for (const launch of launches) {
      const browser = await launch()
      await browser.close()
    }
    return 0
  } catch (err) {
    process.stderr.write(`Browser failed to launch: ${String(err)}\n`)
    return 1
  }
}

function probeLaunches(browserName, playwright) {
  if (!/^[A-Za-z0-9_-]+$/.test(browserName)) return 'browser must be a single token'
  if (browserName === 'chromium' || chromiumChannels.has(browserName)) {
    const browser = playwright.chromium
    if (!browser) return 'Playwright has no browser chromium'
    if (browserName === 'chromium') {
      return [() => browser.launch(), () => browser.launch({ channel: 'chromium' })]
    }
    return [() => browser.launch({ channel: browserName })]
  }
  const browser = playwright[browserName]
  if (!browser) return `Playwright has no browser ${browserName}`
  return [() => browser.launch()]
}

function hasCode(err, code) {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code
}

async function loadPlaywright(workspace) {
  const require = createRequire(join(workspace, 'package.json'))
  let missing
  for (const specifier of ['playwright', '@playwright/test']) {
    try {
      return require(specifier)
    } catch (err) {
      if (hasCode(err, 'ERR_REQUIRE_ESM')) {
        return import(pathToFileURL(require.resolve(specifier)).href)
      }
      if (!hasCode(err, 'MODULE_NOT_FOUND')) throw err
      missing = err
    }
  }
  throw missing
}

function ranAsScript() {
  const entry = process.argv[1]
  if (entry === undefined) return false
  // argv keeps the path the caller passed. import.meta.url is the real file,
  // which differs when that path goes through a symlink such as macOS /var.
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}

if (ranAsScript()) {
  const browserName = process.env.PLAYWRIGHT_BROWSER ?? 'chromium'
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  let exitCode = 1
  try {
    // Resolve from the caller workspace. The script itself lives in the action checkout.
    const playwright = await loadPlaywright(workspace)
    const launches = probeLaunches(browserName, playwright)
    exitCode = typeof launches === 'string' ? 1 : await chromiumLaunchProbeExitCode(launches)
    if (typeof launches === 'string') process.stderr.write(`${launches}\n`)
  } catch (err) {
    process.stderr.write(`Browser failed to launch: ${String(err)}\n`)
  }
  process.exit(exitCode)
}
