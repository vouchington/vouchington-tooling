import { describe, expect, it } from 'vitest'

import {
  clearPersistentCache,
  initialCachePlan,
  nextCachePlan,
  promoteAttemptCache,
  storybookBrowserPersistentCacheDir,
} from './cache-plan.mts'
import { runStorybookBrowserTests } from './index.mts'
import { resolveProject } from './options.mts'
import {
  PROJECT,
  exitChild,
  fetchFailure,
  makeChild,
  makeDeps,
  waitFor,
} from './fixtures.test-helpers.mts'
import type { AttemptResult } from './attempt-result.mts'

const project = resolveProject(PROJECT)
const result = (patch: Partial<AttemptResult>) => ({ code: 0, ...patch }) as AttemptResult

describe('storybookBrowserPersistentCacheDir', () => {
  it('is off outside CI unless a directory is configured, and honours the opt-out', () => {
    expect(storybookBrowserPersistentCacheDir(project, {}, '/r')).toBeUndefined()
    expect(storybookBrowserPersistentCacheDir(project, { CI: 'true' }, '/r')).toBe(
      '/r/.cache/vite/storybook-browser',
    )
    expect(
      storybookBrowserPersistentCacheDir(
        project,
        { STORYBOOK_BROWSER_PERSISTENT_CACHE_DIR: 'c' },
        '/r',
      ),
    ).toBe('/r/c')
    expect(
      storybookBrowserPersistentCacheDir(
        project,
        { CI: '1', STORYBOOK_BROWSER_PERSISTENT_CACHE: '0' },
        '/r',
      ),
    ).toBeUndefined()
  })

  it('reads the env names from the configured prefix', () => {
    const custom = resolveProject({ envPrefix: 'SB', projectName: 'p' })
    expect(storybookBrowserPersistentCacheDir(custom, { SB_PERSISTENT_CACHE_DIR: 'x' }, '/r')).toBe(
      '/r/x',
    )
  })
})

describe('cache plans', () => {
  it('starts on the persistent cache, else on the attempt cache from the env', () => {
    expect(initialCachePlan({}, '/p')).toEqual({
      dir: '/p',
      persistentDir: '/p',
      role: 'persistent',
    })
    expect(initialCachePlan({ VITEST_STORYBOOK_BROWSER_CACHE_DIR: '/a' }, undefined)).toEqual({
      dir: '/a',
      persistentDir: undefined,
      role: 'attempt',
    })
    expect(() => initialCachePlan({}, undefined)).toThrow('did not set Vite cache dir')
  })

  it('moves to a fresh attempt cache after a startup failure and clears the persistent one', () => {
    const harness = makeDeps([])
    const plan = { dir: '/p', persistentDir: '/p', role: 'persistent' as const }
    const input = { attempt: 1, attemptEnv: {}, deps: harness.deps, persistentCacheDir: '/p' }
    for (const failure of [
      { isStall: true },
      { runnerMissing: true },
      { viteFetchFailure: true },
      { hung: true, viteReady: false },
    ]) {
      const next = nextCachePlan({ ...input, cachePlan: plan, result: result(failure) })
      expect(next).toEqual({
        dir: '/repo/node_modules/.vite/storybook-browser-attempt-2',
        persistentDir: '/p',
        role: 'attempt',
      })
    }
    const fresh = '/repo/node_modules/.vite/storybook-browser-attempt-2'
    expect(harness.removed).toEqual(['/p', fresh, '/p', fresh, '/p', fresh, '/p', fresh])
    expect(harness.stderr[0]).toContain('clearing persistent cache after failed startup: /p')
  })

  it('keeps the plan when Vite found new deps, the hang came after startup, or nothing failed', () => {
    const harness = makeDeps([])
    const plan = { dir: '/p', persistentDir: '/p', role: 'persistent' as const }
    const input = { attempt: 1, attemptEnv: {}, cachePlan: plan, deps: harness.deps }
    for (const outcome of [
      { isStall: true, optimizerReloadFromNewDeps: true },
      { hung: true, viteReady: true },
      {},
    ])
      expect(nextCachePlan({ ...input, persistentCacheDir: '/p', result: result(outcome) })).toBe(
        plan,
      )
    expect(harness.removed).toEqual([])
  })

  it('removes only the next attempt directory when the failed cache was an attempt cache', () => {
    const harness = makeDeps([])
    const plan = { dir: '/a1', persistentDir: undefined, role: 'attempt' as const }
    nextCachePlan({
      attempt: 1,
      attemptEnv: {},
      cachePlan: plan,
      deps: harness.deps,
      persistentCacheDir: undefined,
      result: result({ isStall: true }),
    })
    expect(harness.removed).toEqual(['/repo/node_modules/.vite/storybook-browser-attempt-2'])
  })

  it('clearPersistentCache removes the directory recursively', () => {
    const harness = makeDeps([])
    clearPersistentCache('/p', harness.deps)
    expect(harness.removed).toEqual(['/p'])
  })
})

describe('promoteAttemptCache', () => {
  const attemptPlan = { dir: '/a1', persistentDir: '/repo/p/cache', role: 'attempt' as const }

  it('copies a successful attempt cache over the persistent cache', () => {
    const harness = makeDeps([], { exists: (path) => path === '/a1/deps/_metadata.json' })
    promoteAttemptCache(attemptPlan, harness.deps, result({}))
    expect(harness.removed).toEqual(['/repo/p/cache'])
    expect(harness.dirs).toEqual(['/repo/p'])
    expect(harness.copied).toEqual([{ dest: '/repo/p/cache', src: '/a1' }])
    expect(harness.stderr[0]).toContain('promoted attempt cache /a1 to persistent cache')
  })

  it('does not promote a cache without optimizer metadata', () => {
    const harness = makeDeps([])
    promoteAttemptCache(attemptPlan, harness.deps, result({}))
    expect(harness.copied).toEqual([])
    expect(harness.stderr[0]).toContain('optimizer metadata missing in /a1')
  })

  it('skips failures, persistent plans and plans without a persistent directory', () => {
    const harness = makeDeps([], { exists: () => true })
    promoteAttemptCache(attemptPlan, harness.deps, result({ code: 1 }))
    promoteAttemptCache({ ...attemptPlan, role: 'persistent' }, harness.deps, result({}))
    promoteAttemptCache({ ...attemptPlan, persistentDir: undefined }, harness.deps, result({}))
    expect(harness.copied).toEqual([])
    expect(harness.stderr).toEqual([])
  })
})

describe('persistent cache across attempts', () => {
  it('uses the persistent cache, clears it after a fetch failure and promotes the retry', async () => {
    const children = [makeChild(100), makeChild(101)]
    const harness = makeDeps(children, {
      exists: (path) => path.endsWith('deps/_metadata.json'),
    })
    const run = runStorybookBrowserTests(
      PROJECT,
      { env: { CI: '1', RUNNER_TEMP: '/tmp/rt', STORYBOOK_BROWSER_STARTUP_ATTEMPTS: '2' } },
      harness.deps,
    )
    expect(harness.spawnCalls[0]!.env.VITEST_STORYBOOK_BROWSER_CACHE_DIR).toBe(
      '/repo/.cache/vite/storybook-browser',
    )
    expect(harness.dirs).toContain('/repo/.cache/vite/storybook-browser')
    children[0]!.stderr.emit('data', fetchFailure)
    exitChild(children[0]!, 1)
    await waitFor(() => harness.spawnCalls.length === 2)
    expect(harness.spawnCalls[1]!.env.VITEST_STORYBOOK_BROWSER_CACHE_DIR).toBe(
      '/tmp/rt/vite-storybook-browser-attempt-2',
    )
    exitChild(children[1]!, 0)
    await expect(run).resolves.toBe(0)
    expect(harness.copied).toEqual([
      {
        dest: '/repo/.cache/vite/storybook-browser',
        src: '/tmp/rt/vite-storybook-browser-attempt-2',
      },
    ])
  })
})
