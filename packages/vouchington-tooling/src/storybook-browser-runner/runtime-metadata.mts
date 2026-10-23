import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

interface PackageManifest {
  name?: string
  version?: string
}

interface PlaywrightBrowsersManifest {
  browsers?: Array<{ browserVersion?: string; name?: string; revision?: string }>
}

export interface StorybookBrowserRuntimeMetadata {
  architecture: string
  chromium: string
  node: string
  platform: NodeJS.Platform
  playwright: string
  storybookAddonVitest: string
  vitest: string
  vitestBrowserPlaywright: string
}

type Resolver = (packageName: string) => string

/** Versions as the consumer resolves them: packages are looked up from `cwd`, not from this package. */
export function storybookBrowserRuntimeMetadata(cwd: string): StorybookBrowserRuntimeMetadata {
  const resolveFrom = createRequire(resolve(cwd, 'package.json')).resolve
  return {
    architecture: process.arch,
    chromium: chromiumVersion(resolveFrom),
    node: process.version,
    platform: process.platform,
    playwright: packageVersion(resolveFrom, 'playwright'),
    storybookAddonVitest: packageVersion(resolveFrom, '@storybook/addon-vitest'),
    vitest: packageVersion(resolveFrom, 'vitest'),
    vitestBrowserPlaywright: packageVersion(resolveFrom, '@vitest/browser-playwright'),
  }
}

function packageVersion(resolveFrom: Resolver, packageName: string): string {
  try {
    let directory = dirname(resolveFrom(packageName))
    while (true) {
      const manifestPath = resolve(directory, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = readJson<PackageManifest>(manifestPath)
        if (manifest.name === packageName && manifest.version) return manifest.version
      }
      const parent = dirname(directory)
      if (parent === directory) return 'unknown'
      directory = parent
    }
  } catch {
    return 'unknown'
  }
}

function chromiumVersion(resolveFrom: Resolver): string {
  try {
    const manifest = readJson<PlaywrightBrowsersManifest>(
      resolve(dirname(resolveFrom('playwright-core')), 'browsers.json'),
    )
    const chromium = manifest.browsers?.find((browser) => browser.name === 'chromium')
    return chromium?.browserVersion ?? chromium?.revision ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
