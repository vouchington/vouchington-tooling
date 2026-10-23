import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { parsePositiveInteger } from './options.mts'

const MIN_PORT = 1024
const MAX_TCP_PORT = 65_535

export function makeAttemptEnv(
  projectName: string,
  env: NodeJS.ProcessEnv,
  attempt: number,
  cwd: string,
  priorHang = false,
): NodeJS.ProcessEnv {
  let debug = removeUnboundedProtocolDebug(env.DEBUG)
  debug = appendDebugNamespace(debug, '-pw:protocol*')
  debug = appendDebugNamespace(debug, 'vitest:browser:playwright')
  debug = appendDebugNamespace(debug, 'vitest:browser:api')
  // Keep only bounded browser lifecycle evidence after a hang. Raw protocol traffic can exceed
  // hundreds of MiB while conveying no semantic test progress.
  if (priorHang) debug = appendDebugNamespace(debug, 'pw:browser*')
  return {
    ...env,
    DEBUG: appendDebugNamespace(debug, 'vite:deps'),
    STORYBOOK_DISABLE_TELEMETRY: '1',
    VITEST_COVERAGE_SCOPE: projectName,
    VITEST_PW_DEBUG: '1',
    VITEST_STORYBOOK_BROWSER: '1',
    VITEST_STORYBOOK_BROWSER_API_PORT: String(storybookBrowserApiPort(env, attempt)),
    VITEST_STORYBOOK_BROWSER_CACHE_DIR: storybookBrowserAttemptCacheDir(env, attempt, cwd),
  }
}

export function storybookBrowserAttemptCacheDir(
  env: NodeJS.ProcessEnv,
  attempt: number,
  cwd: string,
): string {
  if (!env.CI && !env.RUNNER_TEMP) {
    return resolve(cwd, `node_modules/.vite/storybook-browser-attempt-${attempt}`)
  }
  return resolve(
    env.RUNNER_TEMP || env.TMPDIR || tmpdir(),
    `vite-storybook-browser-attempt-${attempt}`,
  )
}

function removeUnboundedProtocolDebug(value: string | undefined): string | undefined {
  if (!value) return value
  const namespaces = value
    .split(',')
    .map((namespace) => namespace.trim())
    .filter((namespace) => namespace && !/^-?pw:protocol\*?$/.test(namespace))
  return namespaces.length > 0 ? namespaces.join(',') : undefined
}

function storybookBrowserApiPort(env: NodeJS.ProcessEnv, attempt: number): number {
  const parsed = parsePositiveInteger(env.VITEST_STORYBOOK_BROWSER_API_PORT, 0)
  const explicitPort = parsed >= MIN_PORT && parsed <= MAX_TCP_PORT ? parsed : 0
  const offset = (attempt - 1) * 137
  // Wrap inside the unprivileged range so a retry offset never produces a port that needs root.
  if (explicitPort)
    return MIN_PORT + ((explicitPort - MIN_PORT + offset) % (MAX_TCP_PORT - MIN_PORT + 1))
  return 45_000 + ((process.pid + offset) % 10_000)
}

function appendDebugNamespace(value: string | undefined, namespace: string): string {
  if (!value) return namespace
  return value
    .split(',')
    .map((part) => part.trim())
    .includes(namespace)
    ? value
    : `${value},${namespace}`
}
