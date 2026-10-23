import { parseArgs } from 'node:util'

import type { StorybookBrowserProject } from './types.mts'

export type ParsedStorybookBrowserRunnerArgs = StorybookBrowserProject

function required(raw: string, flag: string): string {
  if (raw.length === 0 || raw.startsWith('-')) throw new Error(`${flag} requires a value`)
  return raw
}

/**
 * Parses the `storybook-browser-runner` flags. Arguments after `--` replace the default argv
 * (`exec vitest run --project <name>`), so they may begin with a dash. Flag values that begin
 * with a dash use the `--flag=value` form. Throws an Error naming the first problem.
 */
export function parseStorybookBrowserRunnerArgs(
  argv: readonly string[],
): ParsedStorybookBrowserRunnerArgs {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: {
      command: { type: 'string' },
      'completion-file': { type: 'string' },
      'coverage-arg': { type: 'string', multiple: true },
      'env-prefix': { type: 'string' },
      'optimize-deps-config': { type: 'string' },
      'progress-prefix': { type: 'string' },
      project: { type: 'string' },
      'result-file': { type: 'string', multiple: true },
    },
    strict: true,
  })
  if (values.project === undefined) throw new Error('--project <name> is required')
  const optional = (
    flag: 'command' | 'completion-file' | 'env-prefix' | 'optimize-deps-config' | 'progress-prefix',
  ) => {
    const raw = values[flag]
    return raw === undefined ? undefined : required(raw, `--${flag}`)
  }
  const project: StorybookBrowserProject = { projectName: required(values.project, '--project') }
  const assign = <K extends keyof StorybookBrowserProject>(
    key: K,
    value: StorybookBrowserProject[K] | undefined,
  ) => {
    if (value !== undefined) project[key] = value
  }
  assign('command', optional('command'))
  assign('completionFile', optional('completion-file'))
  assign('envPrefix', optional('env-prefix'))
  assign('optimizeDepsConfigPath', optional('optimize-deps-config'))
  assign('progressPrefix', optional('progress-prefix'))
  if (values['coverage-arg']) project.coverageArgs = values['coverage-arg']
  if (values['result-file']) {
    project.resultFiles = values['result-file'].map((file) => required(file, '--result-file'))
  }
  if (positionals.length > 0) project.args = positionals
  return project
}
