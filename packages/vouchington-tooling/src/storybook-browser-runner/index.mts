import { dirname, resolve } from 'node:path'

import { formatAttemptResult } from './attempt-result.mts'
import {
  initialCachePlan,
  nextCachePlan,
  promoteAttemptCache,
  storybookBrowserPersistentCacheDir,
  type CachePlan,
} from './cache-plan.mts'
import { StorybookBrowserDiagnostics } from './diagnostics.mts'
import { makeAttemptEnv } from './env.mts'
import { resolveProject, resolveRunnerOptions } from './options.mts'
import { runUpstreamAttempt } from './run-attempt.mts'
import { storybookBrowserRuntimeMetadata } from './runtime-metadata.mts'
import { defaultRunnerDeps } from './session-deps.mts'
import type {
  ResolvedStorybookBrowserProject,
  StorybookBrowserProject,
  StorybookBrowserRunnerDeps,
} from './types.mts'

export { makeAttemptEnv, storybookBrowserAttemptCacheDir } from './env.mts'
export {
  commandArgs,
  parsePositiveInteger,
  resolveProject,
  resolveRunnerOptions,
} from './options.mts'
export type { StorybookBrowserRunnerOptions } from './options.mts'
export { parseStorybookBrowserRunnerArgs } from './args.mts'
export type { ParsedStorybookBrowserRunnerArgs } from './args.mts'
export type {
  ResolvedStorybookBrowserProject,
  StorybookBrowserProject,
  StorybookBrowserRunnerDeps,
} from './types.mts'

/**
 * Runs the Storybook Vitest browser project under a watchdog with a Vite optimizer cache, retries
 * on known Vite and browser start-up flakes, and a shared session budget. Resolves with the
 * process exit code.
 */
export async function runStorybookBrowserTests(
  project: StorybookBrowserProject,
  options: { env?: NodeJS.ProcessEnv } = {},
  deps: StorybookBrowserRunnerDeps = defaultRunnerDeps(),
): Promise<number> {
  const resolved = resolveProject(project)
  const env = { ...process.env, ...options.env }
  const settings = resolveRunnerOptions(resolved, env)
  const sessionDeadlineAt = deps.now() + settings.sessionBudgetMs
  const diagnostics = new StorybookBrowserDiagnostics()
  const runtimeSummary = `[storybook-browser] runtime=${JSON.stringify(storybookBrowserRuntimeMetadata(deps.cwd))}\n`
  deps.stderr.write(runtimeSummary)
  diagnostics.recordAttempt(runtimeSummary)
  const diagnosticsPath = resolve(deps.cwd, settings.diagnosticsFile)
  const persistentCacheDir = storybookBrowserPersistentCacheDir(resolved, env, deps.cwd)
  let cachePlan: CachePlan | undefined
  let priorHang = false
  for (let attempt = 1; ; attempt += 1) {
    for (const path of resolved.resultFiles) deps.rmSync(resolve(deps.cwd, path), { force: true })
    const attemptEnv = makeAttemptEnv(resolved.projectName, env, attempt, deps.cwd, priorHang)
    cachePlan ??= initialCachePlan(attemptEnv, persistentCacheDir)
    attemptEnv.VITEST_STORYBOOK_BROWSER_CACHE_DIR = cachePlan.dir
    if (cachePlan.role === 'persistent') deps.mkdirSync(cachePlan.dir, { recursive: true })
    deps.stderr.write(
      `[storybook-browser] starting attempt ${attempt}/${settings.attempts} with ${cachePlan.role} cache ${cachePlan.dir}; optimizerStallMs=${settings.stallMs}; hangMs=${settings.hangMs}\n`,
    )
    const result = await runUpstreamAttempt({
      deps,
      diagnostics,
      env: attemptEnv,
      options: settings,
      project: resolved,
      sessionDeadlineAt,
    })
    record(deps, diagnostics, formatAttemptResult(attempt, result))
    if (result.optimizerReloadFromNewDeps)
      record(deps, diagnostics, newDepsGuidance(resolved, result.newOptimizeDeps))
    deps.mkdirSync(dirname(diagnosticsPath), { recursive: true })
    deps.writeFileSync(diagnosticsPath, diagnostics.render())
    promoteAttemptCache(cachePlan, deps, result)
    if (result.code === 0) return 0
    if (!result.retryable || attempt === settings.attempts) return result.code
    cachePlan = nextCachePlan({ attempt, attemptEnv, cachePlan, deps, persistentCacheDir, result })
    priorHang = result.hung
    deps.stderr.write(
      `[storybook-browser] retrying after retryable Vite/browser failure on attempt ${attempt}\n`,
    )
  }
}

function record(
  deps: StorybookBrowserRunnerDeps,
  diagnostics: StorybookBrowserDiagnostics,
  message: string,
): void {
  deps.stderr.write(message)
  diagnostics.recordAttempt(message)
}

function newDepsGuidance(project: ResolvedStorybookBrowserProject, packages: string[]): string {
  return (
    `[storybook-browser] Vite discovered new optimizeDeps during the browser run: ${packages.join(', ') || 'unknown packages'}. ` +
    `${project.optimizeDepsGuidance} This is not a retryable startup flake.\n`
  )
}
