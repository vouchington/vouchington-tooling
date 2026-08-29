import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { runPnpmInstallCli } from '../cli/commands/pnpm-install.mts'
import { fakePnpmScript } from './pnpm-install-fake-pnpm.test-helpers.mts'

const execFileAsync = promisify(execFile)

export type FixtureOptions = {
  commandTimeoutSeconds?: number
  installScripts?: boolean
  lifecycle?: 'ephemeral' | 'ephemeral-full' | 'persistent'
  maxAttempts?: number
  selectors?: string
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value)}\n`)
}

export async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'pnpm-install-'))
  const consumer = join(root, 'packages', 'consumer')
  const dependency = join(root, 'packages', 'dependency')
  const dependencyLink = join(consumer, 'node_modules', '@fixture', 'dependency')
  const pnpmBin = join(root, 'bin')
  const pnpmLog = join(root, 'pnpm.log')
  const summary = join(root, 'summary.md')

  await Promise.all([
    writeJson(join(root, 'package.json'), { name: 'fixture-root', private: true }),
    writeFile(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\nminimumReleaseAge: 2880\n',
    ),
    writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\npackages: {}\n'),
    writeJson(join(consumer, 'package.json'), {
      name: '@fixture/consumer',
      dependencies: { '@fixture/dependency': 'workspace:^' },
    }),
    writeJson(join(dependency, 'package.json'), { name: '@fixture/dependency', version: '1.0.0' }),
    mkdir(dirname(dependencyLink), { recursive: true }),
    mkdir(pnpmBin),
  ])
  await symlink(dependency, dependencyLink, 'dir')
  await writeFile(join(pnpmBin, 'pnpm'), fakePnpmScript())
  await execFileAsync('chmod', ['+x', join(pnpmBin, 'pnpm')])

  const workspaces = [
    { name: 'fixture-root', path: root },
    { name: '@fixture/consumer', path: consumer },
    { name: '@fixture/dependency', path: dependency },
  ]
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_STEP_SUMMARY: summary,
    PATH: `${pnpmBin}:${process.env.PATH ?? ''}`,
    PNPM_CALLS: join(root, 'pnpm.calls'),
    PNPM_DEPENDENCY: dependency,
    PNPM_DEPENDENCY_LINK: dependencyLink,
    PNPM_LOG: pnpmLog,
    PNPM_NODE_MODULES: join(root, 'node_modules'),
    PNPM_PENDING_BUILDS: '',
    PNPM_REPAIR_LINK: '0',
    PNPM_REBUILD_BREAK_LINK: '0',
    PNPM_WORKSPACES_JSON: JSON.stringify(workspaces),
  }
  return {
    consumer,
    dependency,
    dependencyLink,
    env,
    pnpmLog,
    root,
    summary,
  }
}

export async function runInstaller(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  options: FixtureOptions = {},
) {
  const lifecycle = options.lifecycle ?? 'persistent'
  const installScripts = options.installScripts ?? true
  const args = [
    '--runner-lifecycle',
    lifecycle,
    '--install-scripts',
    String(installScripts),
    '--command-timeout-seconds',
    String(options.commandTimeoutSeconds ?? 0),
    '--max-attempts',
    String(options.maxAttempts ?? 1),
  ]
  if (options.selectors !== undefined) args.push('--ephemeral-workspaces', options.selectors)
  const previousCwd = process.cwd()
  const previousEnv = { ...process.env }
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  const write = (chunk: string | Uint8Array, sink: string[]) => {
    sink.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    return true
  }
  const stdout = process.stdout.write.bind(process.stdout)
  const stderr = process.stderr.write.bind(process.stderr)
  const warn = console.warn
  const error = console.error
  process.stdout.write = ((chunk: string | Uint8Array) =>
    write(chunk, stdoutChunks)) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) =>
    write(chunk, stderrChunks)) as typeof process.stderr.write
  console.warn = (...values: unknown[]) => {
    stderrChunks.push(values.map(String).join(' '))
  }
  console.error = (...values: unknown[]) => {
    stderrChunks.push(values.map(String).join(' '))
  }
  process.chdir(fixture.root)
  Object.assign(process.env, fixture.env)
  try {
    const code = await runPnpmInstallCli(args)
    const result = { stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') }
    if (code !== 0) {
      throw Object.assign(new Error(result.stderr || 'pnpm-install failed'), {
        code,
        stdout: result.stdout,
        stderr: result.stderr,
      })
    }
    return result
  } finally {
    process.stdout.write = stdout
    process.stderr.write = stderr
    console.warn = warn
    console.error = error
    process.chdir(previousCwd)
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key]
    }
    Object.assign(process.env, previousEnv)
  }
}

export async function installCalls(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  try {
    return (await readFile(fixture.pnpmLog, 'utf8')).trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

export async function resetInstallCalls(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  await Promise.all([
    rm(fixture.pnpmLog, { force: true }),
    rm(fixture.env.PNPM_CALLS!, { force: true }),
  ])
}
