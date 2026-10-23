import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { storybookBrowserRuntimeMetadata } from './runtime-metadata.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function project(packages: Record<string, { files: Record<string, string>; main?: string }>) {
  const root = mkdtempSync(join(tmpdir(), 'sb-meta-'))
  dirs.push(root)
  writeFileSync(join(root, 'package.json'), '{}')
  for (const [name, { files, main }] of Object.entries(packages)) {
    const dir = join(root, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ main, name }))
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(dir, file, '..'), { recursive: true })
      writeFileSync(join(dir, file), content)
    }
  }
  return root
}

describe('storybookBrowserRuntimeMetadata', () => {
  it('reports versions as the consumer project resolves them', () => {
    const root = project({
      playwright: { files: { 'index.js': '' } },
      'playwright-core': {
        files: {
          'browsers.json': JSON.stringify({
            browsers: [{ name: 'firefox' }, { browserVersion: '140.0', name: 'chromium' }],
          }),
          'index.js': '',
        },
      },
      vitest: { files: { 'dist/index.js': '' }, main: 'dist/index.js' },
    })
    for (const [name, version, main] of [
      ['playwright', '1.2.3', 'index.js'],
      ['vitest', '5.0.0', 'dist/index.js'],
    ] as const) {
      writeFileSync(
        join(root, 'node_modules', name, 'package.json'),
        JSON.stringify({ main, name, version }),
      )
    }
    const metadata = storybookBrowserRuntimeMetadata(root)
    expect(metadata).toMatchObject({
      architecture: process.arch,
      chromium: '140.0',
      node: process.version,
      platform: process.platform,
      playwright: '1.2.3',
      storybookAddonVitest: 'unknown',
      vitest: '5.0.0',
      vitestBrowserPlaywright: 'unknown',
    })
  })

  it('falls back to the chromium revision and to unknown for unreadable manifests', () => {
    const root = project({
      'playwright-core': {
        files: {
          'browsers.json': JSON.stringify({ browsers: [{ name: 'chromium', revision: '1200' }] }),
          'index.js': '',
        },
      },
      vitest: { files: { 'index.js': '' }, main: 'index.js' },
    })
    expect(storybookBrowserRuntimeMetadata(root)).toMatchObject({
      chromium: '1200',
      vitest: 'unknown',
    })
    writeFileSync(join(root, 'node_modules', 'playwright-core', 'browsers.json'), '{}')
    expect(storybookBrowserRuntimeMetadata(root).chromium).toBe('unknown')
    writeFileSync(join(root, 'node_modules', 'playwright-core', 'browsers.json'), '{ nope')
    expect(storybookBrowserRuntimeMetadata(root).chromium).toBe('unknown')
  })

  it('skips manifests that are for another package while walking up', () => {
    const root = project({ vitest: { files: { 'index.js': '' }, main: 'index.js' } })
    writeFileSync(
      join(root, 'node_modules', 'vitest', 'package.json'),
      JSON.stringify({ main: 'index.js', name: 'other', version: '9' }),
    )
    expect(storybookBrowserRuntimeMetadata(root).vitest).toBe('unknown')
  })
})
