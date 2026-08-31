import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

export type Lifecycle = 'ephemeral' | 'ephemeral-full' | 'persistent'
export type InstallOptions = {
  commandTimeoutSeconds: number
  ephemeralWorkspaces: string
  installScripts: boolean
  maxAttempts: number
  runnerLifecycle: Lifecycle
}
export type CommandResult = { code: number; errorOutput?: string; output: string }
export type CaptureCommand = (args: string[]) => Promise<CommandResult>

export type WorkspaceLinkMismatch = {
  actual: string
  dependency: string
  expected: string
  workspace: string
}

export type Workspace = { name: string; path: string }
type DeclaredDependency = { name: string; spec: string }

const commonInstallArgs = [
  '--prefer-offline',
  '--prod=false',
  '--config.disallow-workspace-cycles=false',
]
export const baseInstallArgs = ['install', '--frozen-lockfile', ...commonInstallArgs]
export const forcedInstallArgs = ['install', '--frozen-lockfile', '--force', ...commonInstallArgs]

const usage =
  'usage: vouchington pnpm-install --runner-lifecycle persistent|ephemeral|ephemeral-full --install-scripts true|false [--ephemeral-workspaces <newline-separated selectors>] [--command-timeout-seconds <nonnegative integer>] [--max-attempts <positive integer>]'
const MAX_COMMAND_TIMEOUT_SECONDS = 3600
const MAX_ATTEMPTS = 10

function fail(message: string): never {
  throw new Error(message)
}

function integer(value: string, name: string, allowZero: boolean, maximum: number) {
  if (!/^\d+$/.test(value) || (!allowZero && value === '0'))
    fail(`${name} must be ${allowZero ? 'a nonnegative' : 'a positive'} integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > maximum) fail(`${name} must not exceed ${maximum}`)
  return parsed
}

export function parseInstallOptions(argv: string[]): InstallOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined || values.has(key)) fail(usage)
    values.set(key, value)
  }
  const supported = new Set([
    '--command-timeout-seconds',
    '--ephemeral-workspaces',
    '--install-scripts',
    '--max-attempts',
    '--runner-lifecycle',
  ])
  if ([...values.keys()].some((key) => !supported.has(key))) fail(usage)
  const runnerLifecycle = values.get('--runner-lifecycle')
  const installScripts = values.get('--install-scripts')
  if (
    (runnerLifecycle !== 'ephemeral' &&
      runnerLifecycle !== 'ephemeral-full' &&
      runnerLifecycle !== 'persistent') ||
    (installScripts !== 'true' && installScripts !== 'false')
  )
    fail(usage)
  return {
    commandTimeoutSeconds: integer(
      values.get('--command-timeout-seconds') ?? '120',
      '--command-timeout-seconds',
      true,
      MAX_COMMAND_TIMEOUT_SECONDS,
    ),
    ephemeralWorkspaces: values.get('--ephemeral-workspaces') ?? '',
    installScripts: installScripts === 'true',
    maxAttempts: integer(
      values.get('--max-attempts') ?? '3',
      '--max-attempts',
      false,
      MAX_ATTEMPTS,
    ),
    runnerLifecycle,
  }
}

export async function listWorkspaces(runCapture: CaptureCommand): Promise<Workspace[]> {
  const result = await runCapture(['m', 'ls', '--depth=-1', '--json'])
  if (result.code !== 0)
    fail(
      `pnpm m ls failed: ${result.errorOutput?.trim() || result.output.trim() || 'unknown error'}`,
    )
  let entries: unknown
  try {
    entries = JSON.parse(result.output)
  } catch {
    fail('pnpm m ls returned invalid workspace JSON')
  }
  if (!Array.isArray(entries) || entries.length === 0)
    fail('pnpm m ls returned an invalid or empty workspace list')
  const listed = entries.flatMap((entry) =>
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { name?: unknown }).name === 'string' &&
    typeof (entry as { path?: unknown }).path === 'string'
      ? [entry as Workspace]
      : [],
  )
  if (listed.length !== entries.length) fail('pnpm m ls returned an invalid workspace list')
  return listed
}

async function workspaceDependencies(workspace: Workspace): Promise<DeclaredDependency[]> {
  const pkg = JSON.parse(
    await readFile(path.join(workspace.path, 'package.json'), 'utf8'),
  ) as Record<string, Record<string, unknown> | undefined>
  return Object.entries({
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  })
    .flatMap(([name, spec]) => (typeof spec === 'string' ? [{ name, spec }] : []))
    .toSorted((left, right) => left.name.localeCompare(right.name))
}

export async function findWorkspaceLinkMismatches(
  runCapture: CaptureCommand,
): Promise<WorkspaceLinkMismatch[]> {
  const workspaces = await listWorkspaces(runCapture)
  const targets = new Map(
    await Promise.all(
      workspaces.map(
        async (workspace) => [workspace.name, await realpath(workspace.path)] as const,
      ),
    ),
  )
  const mismatches: WorkspaceLinkMismatch[] = []
  for (const workspace of workspaces) {
    for (const dependency of await workspaceDependencies(workspace)) {
      if (!dependency.spec.startsWith('workspace:')) continue
      const expected = targets.get(dependency.name)
      const link = path.join(workspace.path, 'node_modules', dependency.name)
      if (!expected) {
        mismatches.push({
          actual: 'unknown workspace',
          dependency: dependency.name,
          expected: dependency.name,
          workspace: workspace.name,
        })
        continue
      }
      try {
        const actual = await realpath(link)
        if (actual !== expected)
          mismatches.push({
            actual,
            dependency: dependency.name,
            expected,
            workspace: workspace.name,
          })
      } catch {
        mismatches.push({
          actual: 'missing or broken link',
          dependency: dependency.name,
          expected,
          workspace: workspace.name,
        })
      }
    }
  }
  return mismatches
}

export function logWorkspaceLinkMismatches(mismatches: WorkspaceLinkMismatch[]) {
  for (const mismatch of mismatches)
    console.warn(
      `workspace link mismatch: ${mismatch.workspace} -> ${mismatch.dependency}; expected ${mismatch.expected}, got ${mismatch.actual}`,
    )
}

export function reportGlibcVersionRuntime(report: object | undefined): string {
  if (!report || !('header' in report)) return ''
  const { header } = report
  if (typeof header !== 'object' || header === null || !('glibcVersionRuntime' in header)) return ''
  const { glibcVersionRuntime } = header
  return typeof glibcVersionRuntime === 'string' ? glibcVersionRuntime : ''
}
