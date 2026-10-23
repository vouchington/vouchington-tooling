import type { InlineConfig } from 'vitest/node'
import { githubActionsReporter } from './vitest-github-actions-reporter.mts'
import {
  createFileProgressWriter,
  createVitestFileProgressReporter,
  type WriteProgress,
} from './vitest-file-progress-reporter.mts'
import { createVitestStorybookProgressReporter } from './vitest-storybook-progress-reporter.mts'

export type VitestReporters = NonNullable<InlineConfig['reporters']>
export type VitestReporter = Extract<VitestReporters, readonly unknown[]>[number]
type VitestOutputFile = NonNullable<InlineConfig['outputFile']>
type Env = Record<string, string | undefined>

export interface CiReporterEnvNames {
  /** Selects the reporter set: unset or empty for local, `run` for CI. */
  reporters: string
  /** `1` streams file progress to stdout. */
  diagnostics: string
  /** Path that buffers file progress when set. */
  fileProgressFile: string
  /** `1` adds the Storybook progress reporter. */
  storybookBrowser: string
  /** Path of the JUnit XML output file. */
  junitOutputFile: string
}

export const DEFAULT_CI_REPORTER_ENV_NAMES: CiReporterEnvNames = {
  reporters: 'VITEST_CI_REPORTERS',
  diagnostics: 'VITEST_DIAGNOSTICS',
  fileProgressFile: 'VITEST_FILE_PROGRESS_FILE',
  storybookBrowser: 'VITEST_STORYBOOK_BROWSER',
  junitOutputFile: 'VITEST_JUNIT_OUTPUT_FILE',
}

export interface CiReportersOptions {
  /** Environment to read; defaults to `process.env`. */
  env?: Env
  /** Override any of the env var names. */
  envNames?: Partial<CiReporterEnvNames>
  /** Marker prefix for file progress lines. */
  fileProgressPrefix?: string
  /** Marker prefix for Storybook progress lines. */
  storybookProgressPrefix?: string
  /** Extra reporters inserted in `run` mode after `junit` (for example no-skips or teardown). */
  extraReporters?: readonly VitestReporter[]
  /** Working directory for the `github-actions` reporter's path normalization. */
  cwd?: string
}

function resolveNames(options: CiReportersOptions): CiReporterEnvNames {
  return { ...DEFAULT_CI_REPORTER_ENV_NAMES, ...options.envNames }
}

function fileProgress(prefix: string | undefined, write?: WriteProgress) {
  return createVitestFileProgressReporter({
    ...(write ? { write } : {}),
    ...(prefix ? { prefix } : {}),
  })
}

function fileProgressReporters(
  env: Env,
  names: CiReporterEnvNames,
  prefix: string | undefined,
): VitestReporter[] {
  const progressFile = env[names.fileProgressFile]
  const toFile = progressFile ? createFileProgressWriter(progressFile) : undefined
  const toStdout = env[names.diagnostics] === '1'
  if (!toFile && !toStdout) return []
  if (!toFile) return [fileProgress(prefix)]
  if (!toStdout) return [fileProgress(prefix, toFile)]
  return [fileProgress(prefix), fileProgress(prefix, toFile)]
}

/**
 * Builds the Vitest reporter list from env vars, or `undefined` for the default reporters.
 * File progress streams to stdout when diagnostics are on and is appended to the progress file
 * when set. Throws for an unknown reporter-set value.
 */
export function ciReporters(options: CiReportersOptions = {}): VitestReporters | undefined {
  const env = options.env ?? process.env
  const names = resolveNames(options)
  const prefix = options.fileProgressPrefix
  const selected = env[names.reporters]
  switch (selected) {
    case undefined:
    case '':
      return env[names.diagnostics] === '1' ? ['default', fileProgress(prefix)] : undefined
    case 'run':
      return [
        'minimal',
        ...(env[names.storybookBrowser] === '1'
          ? [
              createVitestStorybookProgressReporter(
                options.storybookProgressPrefix ? { prefix: options.storybookProgressPrefix } : {},
              ),
            ]
          : []),
        githubActionsReporter({
          env,
          ...(options.cwd ? { cwd: options.cwd } : {}),
        }) as VitestReporter,
        'junit',
        ...(options.extraReporters ?? []),
        'hanging-process',
        ...fileProgressReporters(env, names, prefix),
      ]
    default:
      throw new Error(`Unknown ${names.reporters} value "${selected}". Accepted value: run.`)
  }
}

export function ciOutputFile(options: CiReportersOptions = {}): VitestOutputFile | undefined {
  const junit = (options.env ?? process.env)[resolveNames(options).junitOutputFile]
  return junit ? { junit } : undefined
}
