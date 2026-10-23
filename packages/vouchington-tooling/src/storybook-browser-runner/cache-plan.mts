import { resolve } from 'node:path'

import { storybookBrowserAttemptCacheDir } from './env.mts'
import { envName } from './options.mts'
import type { AttemptResult } from './attempt-result.mts'
import type { ResolvedStorybookBrowserProject, StorybookBrowserRunnerDeps } from './types.mts'

export type CachePlan = {
  dir: string
  persistentDir: string | undefined
  role: 'attempt' | 'persistent'
}

type CacheDeps = Pick<
  StorybookBrowserRunnerDeps,
  'cpSync' | 'cwd' | 'existsSync' | 'mkdirSync' | 'rmSync' | 'stderr'
>

export function storybookBrowserPersistentCacheDir(
  project: ResolvedStorybookBrowserProject,
  env: NodeJS.ProcessEnv,
  cwd: string,
): string | undefined {
  if (env[envName(project, 'PERSISTENT_CACHE')] === '0') return undefined
  const configured = env[envName(project, 'PERSISTENT_CACHE_DIR')]
  if (configured) return resolve(cwd, configured)
  return env.CI ? resolve(cwd, '.cache/vite/storybook-browser') : undefined
}

export function initialCachePlan(
  attemptEnv: NodeJS.ProcessEnv,
  persistentCacheDir: string | undefined,
): CachePlan {
  if (persistentCacheDir) {
    return { dir: persistentCacheDir, persistentDir: persistentCacheDir, role: 'persistent' }
  }
  const dir = attemptEnv.VITEST_STORYBOOK_BROWSER_CACHE_DIR
  if (!dir) throw new Error('makeAttemptEnv did not set Vite cache dir for attempt cache')
  return { dir, persistentDir: persistentCacheDir, role: 'attempt' }
}

export function nextCachePlan(input: {
  attempt: number
  attemptEnv: NodeJS.ProcessEnv
  cachePlan: CachePlan
  deps: CacheDeps
  persistentCacheDir: string | undefined
  result: AttemptResult
}): CachePlan {
  const { attempt, attemptEnv, cachePlan, deps, persistentCacheDir, result } = input
  if (
    !result.optimizerReloadFromNewDeps &&
    (result.isStall ||
      result.runnerMissing ||
      result.viteFetchFailure ||
      (result.hung && !result.viteReady))
  ) {
    if (cachePlan.role === 'persistent') clearPersistentCache(cachePlan.dir, deps)
    // The directory is named by attempt number, so an earlier run may have left stale state in it.
    const dir = storybookBrowserAttemptCacheDir(attemptEnv, attempt + 1, deps.cwd)
    deps.rmSync(dir, { force: true, recursive: true })
    return { dir, persistentDir: persistentCacheDir, role: 'attempt' }
  }
  return cachePlan
}

export function clearPersistentCache(cacheDir: string, deps: CacheDeps): void {
  deps.stderr.write(
    `[storybook-browser] clearing persistent cache after failed startup: ${cacheDir}\n`,
  )
  deps.rmSync(cacheDir, { force: true, recursive: true })
}

/** Copies a successful attempt's optimizer cache over the persistent cache. */
export function promoteAttemptCache(
  cachePlan: CachePlan,
  deps: CacheDeps,
  result: AttemptResult,
): void {
  if (result.code !== 0 || cachePlan.role !== 'attempt' || !cachePlan.persistentDir) return
  if (!deps.existsSync(resolve(cachePlan.dir, 'deps/_metadata.json'))) {
    deps.stderr.write(
      `[storybook-browser] not promoting attempt cache; optimizer metadata missing in ${cachePlan.dir}\n`,
    )
    return
  }
  deps.rmSync(cachePlan.persistentDir, { force: true, recursive: true })
  deps.mkdirSync(resolve(cachePlan.persistentDir, '..'), { recursive: true })
  deps.cpSync(cachePlan.dir, cachePlan.persistentDir, { recursive: true })
  deps.stderr.write(
    `[storybook-browser] promoted attempt cache ${cachePlan.dir} to persistent cache ${cachePlan.persistentDir}\n`,
  )
}
