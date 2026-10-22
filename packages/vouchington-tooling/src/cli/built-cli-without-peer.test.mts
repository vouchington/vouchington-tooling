import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const bin = join(packageRoot, 'bin/vouchington.mjs')
const built = existsSync(join(packageRoot, 'dist/cli/index.mjs'))

const preloadSource = `
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'no-mistakes' || specifier.startsWith('no-mistakes/')) {
      throw Object.assign(
        new Error("Cannot find package 'no-mistakes' imported from " + context.parentURL),
        { code: 'ERR_MODULE_NOT_FOUND' },
      )
    }
    return next(specifier, context)
  },
})
`

describe.skipIf(!built)('built CLI with no-mistakes unresolvable', () => {
  let directory: string
  let preload: string

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'vouchington-no-peer-'))
    preload = join(directory, 'register.mjs')
    writeFileSync(preload, preloadSource)
  })

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  function run(...args: string[]) {
    return spawnSync(process.execPath, ['--import', preload, bin, ...args], {
      encoding: 'utf8',
    })
  }

  it('loads and prints help', () => {
    const result = run('--help')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('story-coverage')
  })

  it('runs a command that does not need no-mistakes', () => {
    expect(run('http-origin', '--help').status).toBe(0)
  })

  it('tells the user which command needs the peer', () => {
    const result = run(
      'story-coverage',
      '--root',
      '.',
      '--component-root',
      'c',
      '--story-root',
      's',
      '--source-extension',
      '.ts',
      '--component-extension',
      '.tsx',
      '--marker',
      'm',
      '--story-pattern',
      's',
      '--alias',
      '@/=c/',
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toBe(
      'story-coverage requires the optional peer dependency no-mistakes; install it alongside vouchington-tooling\n',
    )
  })
})
