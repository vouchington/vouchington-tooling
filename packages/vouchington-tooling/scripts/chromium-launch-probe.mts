#!/usr/bin/env node
// Exit 0 when the selected browser launches and closes cleanly, 1 otherwise.
// setup-playwright runs this before it spends an apt download on playwright install-deps.
// Chromium also launches with channel chromium, because that build can need different
// host libraries than the headless shell. Any failure counts, and the cause is only
// printed, so the probe never depends on Playwright's error wording.

import { createRequire } from 'node:module'
import { join } from 'node:path'

export interface LaunchedBrowser {
  close(): Promise<void>
}

export type BrowserLauncher = () => Promise<LaunchedBrowser>

export async function chromiumLaunchProbeExitCode(
  launches: readonly BrowserLauncher[],
): Promise<0 | 1> {
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

interface PlaywrightBrowsers {
  [name: string]:
    | { launch: (options?: { channel: string }) => Promise<LaunchedBrowser> }
    | undefined
}

function probeLaunches(
  browserName: string,
  playwright: PlaywrightBrowsers,
): BrowserLauncher[] | string {
  if (!/^[A-Za-z0-9_-]+$/.test(browserName)) return 'browser must be a single token'
  const browser = playwright[browserName]
  if (!browser) return `Playwright has no browser ${browserName}`
  if (browserName === 'chromium') {
    return [() => browser.launch(), () => browser.launch({ channel: 'chromium' })]
  }
  return [() => browser.launch()]
}

if (import.meta.main) {
  const browserName = process.env.PLAYWRIGHT_BROWSER ?? 'chromium'
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  let exitCode: 0 | 1 | 2 = 1
  try {
    // Resolve from the caller workspace. The script itself lives in the action checkout.
    const playwright = createRequire(join(workspace, 'package.json'))(
      'playwright',
    ) as PlaywrightBrowsers
    const launches = probeLaunches(browserName, playwright)
    exitCode = typeof launches === 'string' ? 1 : await chromiumLaunchProbeExitCode(launches)
    if (typeof launches === 'string') process.stderr.write(`${launches}\n`)
  } catch (err) {
    process.stderr.write(`Browser failed to launch: ${String(err)}\n`)
  }
  process.exit(exitCode)
}
