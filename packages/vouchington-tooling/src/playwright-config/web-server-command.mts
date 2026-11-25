import type { ReporterDescription } from '@playwright/test'
import { join } from 'node:path'
import TestLifecycleReporter from '../playwright/test-lifecycle-reporter.mts'
import { withNodeOption } from './config-helpers.mts'

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function definedEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

export function playwrightWebServerLogDir(env: NodeJS.ProcessEnv = process.env): string {
  const tempRoot = env['RUNNER_TEMP'] || env['TMPDIR'] || '/tmp'
  return join(tempRoot, 'playwright-web-server-logs')
}

export type CreateReporterOptions = {
  junitOutputFile: string
  ci: boolean
  /** Reporters appended after the built-in ones in both modes. */
  extraReporters?: ReporterDescription[]
  /** Environment read for `PLAYWRIGHT_JUNIT_OUTPUT_FILE`. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
}

// CI: GitHub annotations, JUnit (PLAYWRIGHT_JUNIT_OUTPUT_FILE wins), and a lifecycle reporter that
// fails on skipped tests. Local: the HTML report without opening a browser.
export function createReporter({
  junitOutputFile,
  ci,
  extraReporters = [],
  env = process.env,
}: CreateReporterOptions): ReporterDescription[] {
  return ci
    ? [
        ['github'],
        ['junit', { outputFile: env['PLAYWRIGHT_JUNIT_OUTPUT_FILE'] || junitOutputFile }],
        [TestLifecycleReporter.modulePath, { failOnSkippedTests: ci }],
        ...extraReporters,
      ]
    : [['html', { open: 'never' }], ...extraReporters]
}

function withOtelNodeImport(command: string, otelPreload: string | undefined): string {
  if (!otelPreload) return command
  return command.replace(/(^|\s)node(?=\s)/, `$1node --import ${shellQuote(otelPreload)}`)
}

// `otelPreload` is the module Node imports to register OpenTelemetry; undefined disables it.
export function withOtelNodeOptions(nodeOptions: string, otelPreload: string | undefined): string {
  if (!otelPreload) return nodeOptions
  return withNodeOption(nodeOptions, `--import "${otelPreload}"`)
}

export type LoggedShellCommandOptions = {
  name: string
  command: string
  logDir: string
}

export function loggedShellCommand({ name, command, logDir }: LoggedShellCommandOptions): string {
  const logPath = join(logDir, `${name}.log`)
  return `bash -lc ${shellQuote(`set -o pipefail; mkdir -p ${shellQuote(logDir)}; ${command} 2>&1 | tee ${shellQuote(logPath)}`)}`
}

export type NodeServerCommandOptions = {
  name: string
  serviceName: string
  command: string
  logDir: string
  /** OpenTelemetry preload module path. Omit to run without OpenTelemetry. */
  otelPreload?: string
}

export function nodeServerCommand({
  name,
  serviceName,
  command,
  logDir,
  otelPreload,
}: NodeServerCommandOptions): string {
  const envPrefix = [
    `OTEL_SERVICE_NAME=${shellQuote(serviceName)}`,
    ...(otelPreload ? ['OTEL_LOGS_EXPORTER=otlp'] : []),
  ].join(' ')
  const instrumentedCommand = `${envPrefix} ${withOtelNodeImport(command, otelPreload)}`
  return loggedShellCommand({ name, command: instrumentedCommand, logDir })
}
