import { DEFAULT_STORYBOOK_PROGRESS_PREFIX } from '../vitest-diagnostics/index.mts'
import type { ResolvedStorybookBrowserProject, StorybookBrowserProject } from './types.mts'

const MAX_STARTUP_ATTEMPTS = 3
const DEFAULT_ENV_PREFIX = 'STORYBOOK_BROWSER'

export type StorybookBrowserRunnerOptions = {
  attempts: number
  diagnosticsFile: string
  hangMs: number
  sessionBudgetMs: number
  stallMs: number
  terminationGraceMs: number
}

export function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return value && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function envName(project: { envPrefix: string }, suffix: string): string {
  return `${project.envPrefix}_${suffix}`
}

export function resolveProject(project: StorybookBrowserProject): ResolvedStorybookBrowserProject {
  const projectName = project.projectName.trim()
  if (!projectName) throw new Error('projectName must be a non-empty Vitest project name')
  const config = project.optimizeDepsConfigPath
  return {
    args: project.args ?? ['exec', 'vitest', 'run', '--project', projectName],
    command: project.command ?? 'pnpm',
    completionFile: project.completionFile,
    coverageArgs: project.coverageArgs ?? ['--coverage'],
    envPrefix: project.envPrefix ?? DEFAULT_ENV_PREFIX,
    optimizeDepsGuidance: config
      ? `Add them to the optimizeDeps list in ${config}.`
      : 'Add them to the Storybook Vite optimizeDeps include list.',
    progressPrefix: project.progressPrefix ?? DEFAULT_STORYBOOK_PROGRESS_PREFIX,
    projectName,
    resultFiles: project.resultFiles ?? [],
  }
}

/** Positive integers from the environment; invalid values fall back to the defaults. */
export function resolveRunnerOptions(
  project: ResolvedStorybookBrowserProject,
  env: NodeJS.ProcessEnv,
): StorybookBrowserRunnerOptions {
  const read = (suffix: string, fallback: number) =>
    parsePositiveInteger(env[envName(project, suffix)], fallback)
  const sessionBudgetMs = read('SESSION_BUDGET_MS', 300_000)
  return {
    attempts: Math.min(read('STARTUP_ATTEMPTS', MAX_STARTUP_ATTEMPTS), MAX_STARTUP_ATTEMPTS),
    diagnosticsFile:
      env[envName(project, 'DIAGNOSTICS_FILE')] ?? 'storybook-browser-diagnostics.log',
    hangMs: read('HANG_MS', 120_000),
    sessionBudgetMs,
    stallMs: read('OPTIMIZER_STALL_MS', 30_000),
    // Kept below the budget so termination time never consumes the whole session.
    terminationGraceMs: Math.max(1, Math.min(5000, Math.floor(sessionBudgetMs / 2))),
  }
}

/** Base argv plus the coverage flags unless `<envPrefix>_COVERAGE` is `0`. */
export function commandArgs(
  project: ResolvedStorybookBrowserProject,
  env: NodeJS.ProcessEnv,
): string[] {
  return env[envName(project, 'COVERAGE')] === '0'
    ? [...project.args]
    : [...project.args, ...project.coverageArgs]
}
