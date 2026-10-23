import { describe, expect, it } from 'vitest'

import { runStorybookBrowserTests } from './index.mts'
import {
  PROJECT,
  PROJECT_NAME,
  exitChild,
  fetchFailure,
  makeChild,
  makeDeps,
  progress,
  runnerMissing,
  waitFor,
} from './fixtures.test-helpers.mts'

const baseEnv = { CI: '', RUNNER_TEMP: '', STORYBOOK_BROWSER_STARTUP_ATTEMPTS: '2' }

function setup(count = 1, extraEnv: NodeJS.ProcessEnv = {}) {
  const clock = { t: 0 }
  const children = Array.from({ length: count }, (_, i) => makeChild(100 + i))
  const harness = makeDeps(children, { now: () => clock.t })
  const run = runStorybookBrowserTests(PROJECT, { env: { ...baseEnv, ...extraEnv } }, harness.deps)
  return { children, clock, harness, run }
}

describe('runStorybookBrowserTests', () => {
  it('runs the project command, clears result files and hides progress markers on success', async () => {
    const { children, harness, run } = setup()
    const [child] = children
    child!.stdout.emit('data', `${progress(1)}ran ${PROJECT_NAME}\n`)
    exitChild(child!, 0)
    await expect(run).resolves.toBe(0)
    const [call] = harness.spawnCalls
    expect(call!.command).toBe('pnpm')
    expect(call!.args).toEqual(['exec', 'vitest', 'run', '--project', PROJECT_NAME, '--coverage'])
    expect(call!.env).toMatchObject({
      STORYBOOK_DISABLE_TELEMETRY: '1',
      VITEST_COVERAGE_SCOPE: PROJECT_NAME,
      VITEST_STORYBOOK_BROWSER: '1',
    })
    expect(call!.env.VITEST_STORYBOOK_BROWSER_CACHE_DIR).toBe(
      '/repo/node_modules/.vite/storybook-browser-attempt-1',
    )
    expect(harness.removed).toEqual([
      '/repo/.vitest-reports/browser-suite.json',
      '/repo/coverage/lcov.info',
    ])
    expect(harness.stdout.join('')).toContain(`ran ${PROJECT_NAME}`)
    expect(harness.stdout.join('')).not.toContain('seq=1')
    expect(harness.stderr.join('')).toContain('starting attempt 1/2 with attempt cache')
    expect(harness.written[0]!.path).toBe('/repo/storybook-browser-diagnostics.log')
    expect(harness.dirs).toContain('/repo')
    expect(harness.written[0]!.content).toContain('attempt=1 finished')
    expect(harness.intervals).toHaveLength(0)
  })

  it('omits the coverage args when coverage is disabled and honours custom argv', async () => {
    const child = makeChild(100)
    const harness = makeDeps([child])
    const run = runStorybookBrowserTests(
      { ...PROJECT, args: ['run', '--bail=3'], command: 'vitest' },
      { env: { ...baseEnv, STORYBOOK_BROWSER_COVERAGE: '0' } },
      harness.deps,
    )
    exitChild(child, 0)
    await expect(run).resolves.toBe(0)
    expect(harness.spawnCalls[0]).toMatchObject({ args: ['run', '--bail=3'], command: 'vitest' })
  })

  it('returns the failing code without retrying and replays suppressed output', async () => {
    const { children, harness, run } = setup()
    children[0]!.stdout.emit('data', progress(1))
    children[0]!.stdout.emit('data', 'plain failure\n')
    exitChild(children[0]!, 3)
    await expect(run).resolves.toBe(3)
    expect(harness.spawnCalls).toHaveLength(1)
    expect(harness.stderr.join('')).toContain('replaying suppressed progress markers')
    expect(harness.stdout.join('')).toContain('seq=1')
    expect(harness.stderr.join('')).not.toContain('retrying after')
  })

  it('retries a Vite fetch failure with a fresh attempt cache', async () => {
    const { children, harness, run } = setup(2)
    children[0]!.stderr.emit('data', fetchFailure)
    exitChild(children[0]!, 1)
    await waitFor(() => harness.spawnCalls.length === 2)
    exitChild(children[1]!, 0)
    await expect(run).resolves.toBe(0)
    expect(harness.stderr.join('')).toContain('retrying after retryable Vite/browser failure')
    expect(harness.spawnCalls[1]!.env.VITEST_STORYBOOK_BROWSER_CACHE_DIR).toContain('attempt-2')
    expect(harness.written.at(-1)!.content).toContain('attempt=2')
  })

  it('retries when the add-on setup file cannot find the Vitest runner', async () => {
    const { children, harness, run } = setup(2)
    children[0]!.stderr.emit('data', `\u001B[31m${runnerMissing}\u001B[0m`)
    exitChild(children[0]!, 1)
    await waitFor(() => harness.spawnCalls.length === 2)
    exitChild(children[1]!, 0)
    await expect(run).resolves.toBe(0)
    expect(harness.written.at(0)!.content).toContain('runnerMissing=true')
  })

  it('does not retry when Vite discovers new optimizeDeps and names the config', async () => {
    const { children, harness, run } = setup(2)
    children[0]!.stderr.emit(
      'data',
      'new dependencies found: react-dom, @scope/pkg\noptimized dependencies changed. reloading\n',
    )
    children[0]!.stderr.emit('data', fetchFailure)
    exitChild(children[0]!, 1)
    await expect(run).resolves.toBe(1)
    const text = harness.stderr.join('')
    expect(text).toContain('new optimizeDeps during the browser run: react-dom, @scope/pkg')
    expect(text).toContain('Add them to the optimizeDeps list in config/optimize-deps.mts.')
    expect(text).toContain('This is not a retryable startup flake.')
  })

  it('names unknown packages and uses the generic guidance without a config path', async () => {
    const child = makeChild(100)
    const harness = makeDeps([child])
    const run = runStorybookBrowserTests(
      { projectName: PROJECT_NAME },
      { env: baseEnv },
      harness.deps,
    )
    child.stderr.emit(
      'data',
      'optimized dependencies changed. reloading\nnew dependencies found:\n',
    )
    exitChild(child, 1)
    await expect(run).resolves.toBe(1)
    const text = harness.stderr.join('')
    expect(text).toContain('unknown packages')
    expect(text).toContain('Add them to the Storybook Vite optimizeDeps include list.')
  })

  it('stops after the configured attempts and reports the last code', async () => {
    const { children, harness, run } = setup(2)
    children[0]!.stderr.emit('data', fetchFailure)
    exitChild(children[0]!, 1)
    await waitFor(() => harness.spawnCalls.length === 2)
    children[1]!.stderr.emit('data', fetchFailure)
    exitChild(children[1]!, 5)
    await expect(run).resolves.toBe(5)
  })

  it('caps the startup attempts at three', async () => {
    const { children, harness, run } = setup(3, { STORYBOOK_BROWSER_STARTUP_ATTEMPTS: '9' })
    for (const [index, child] of children.entries()) {
      await waitFor(() => harness.spawnCalls.length === index + 1)
      child.stderr.emit('data', fetchFailure)
      exitChild(child, 1)
    }
    await expect(run).resolves.toBe(1)
    expect(harness.stderr.join('')).toContain('attempt 3/3')
  })
})
