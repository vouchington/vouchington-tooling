import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
export const guardPath = fileURLToPath(new URL('./test-timeout.mts', import.meta.url))
const playwrightPackage = createRequire(import.meta.url).resolve('@playwright/test/package.json')
const cli = join(dirname(playwrightPackage), 'cli.js')
const modules = dirname(dirname(dirname(playwrightPackage)))

export const FIXTURE_NAME = 'capGuardFixture'
export const capError =
  /positive finite number at most 30,000 ms|slow modifiers are forbidden|timeout guard overrides are forbidden/

type RunOptions = {
  banOverrides?: boolean
  collection?: string
  cliTimeout?: string
  extended?: boolean
  workerFixture?: boolean
}

type Capture = {
  code: number
  output: string
  stats?: { expected: number; unexpected: number } | undefined
  errors: { message: string; location?: { file: string; line: number } }[]
}

function parseReport(stdout: string, stderr: string): Omit<Capture, 'code'> {
  const output = stdout + stderr
  try {
    const report = JSON.parse(stdout) as {
      stats: Capture['stats']
      suites: { specs: { tests: { results: { errors: Capture['errors'] }[] }[] }[] }[]
    }
    const errors = report.suites.flatMap((suite) =>
      suite.specs.flatMap((spec) =>
        spec.tests.flatMap((test) => test.results.flatMap((result) => result.errors)),
      ),
    )
    return { output, stats: report.stats, errors }
  } catch {
    // CLI argument failures may precede reporter creation.
    return { output, errors: [] }
  }
}

export async function runFixture(body: string, options: RunOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'playwright-public-cap-'))
  try {
    await symlink(modules, join(dir, 'node_modules'), 'dir')
    await writeFile(
      join(dir, 'setup.mts'),
      `import { createPlaywrightTimeoutGuard } from ${JSON.stringify(guardPath)}
export default createPlaywrightTimeoutGuard({ fixtureName: '${FIXTURE_NAME}' }).assertResolvedTimeouts`,
    )
    await writeFile(
      join(dir, 'playwright.config.mts'),
      `export default { testDir: '.', testMatch: '**/*.spec.mts', globalSetup: './setup.mts', timeout: 30000, workers: 1, retries: 0, reporter: 'json' }`,
    )
    const fixture = options.workerFixture
      ? "[async ({}, use) => await use('fixture'), { scope: 'worker' }]"
      : "async ({}, use) => await use('fixture')"
    const guardOptions = options.banOverrides
      ? `{ fixtureName: '${FIXTURE_NAME}', banOverrides: true }`
      : `{ fixtureName: '${FIXTURE_NAME}' }`
    const specSource = `
      import { test as raw } from '@playwright/test'
      import { writeFileSync } from 'node:fs'
      import { createPlaywrightTimeoutGuard } from ${JSON.stringify(guardPath)}
      const { guardTestTimeouts, protectHookTimeouts } = createPlaywrightTimeoutGuard(${guardOptions})
      const guarded = guardTestTimeouts(raw)
      const test = ${options.extended ? `guarded.extend({ sample: ${fixture} })` : 'guarded'}
      ${options.collection ?? ''}
      test('tiny public boundary', async (${options.extended ? '{ sample }' : '{}'}, info) => {
        ${body}
        writeFileSync(${JSON.stringify(join(dir, 'body.marker'))}, 'continued')
      })
    `
    await writeFile(join(dir, 'tiny.spec.mts'), specSource)
    const args = [cli, 'test', '--config', join(dir, 'playwright.config.mts')]
    if (options.cliTimeout !== undefined) args.push('--timeout', options.cliTimeout)
    let code = 0
    let captured: Omit<Capture, 'code'>
    try {
      const result = await exec(process.execPath, args, { cwd: dir, timeout: 30_000 })
      captured = parseReport(result.stdout, result.stderr)
    } catch (err) {
      const result = err as Error & { code: number; stdout: string; stderr: string }
      code = result.code
      captured = parseReport(result.stdout, result.stderr)
    }
    const marker = await readFile(join(dir, 'body.marker'), 'utf8').catch(() => undefined)
    const hookMarker = await readFile(join(dir, 'hook.marker'), 'utf8').catch(() => undefined)
    return { code, ...captured, marker, hookMarker, specSource }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
