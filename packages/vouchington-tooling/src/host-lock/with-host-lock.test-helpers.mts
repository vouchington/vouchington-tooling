import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

export const execFileAsync = promisify(execFile)
export const hostLockScript = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/host-lock/with-host-lock.sh',
)
const testHomes: string[] = []

export async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'host-lock-'))
  testHomes.push(home)
  return home
}

function hostLockRoot(home: string): string {
  return join(home, '.cache/host-lock')
}

export function hostLockEnv(home: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    HOST_LOCK_ROOT: hostLockRoot(home),
    ...overrides,
  }
}

export function hostLockArgs(
  name: string,
  timeoutSeconds: number,
  command: string[],
  extraArgs: string[] = [],
): string[] {
  return [
    hostLockScript,
    '--name',
    name,
    '--timeout-seconds',
    String(timeoutSeconds),
    ...extraArgs,
    '--',
    ...command,
  ]
}

export function spawnHostLock(
  home: string,
  name: string,
  timeoutSeconds: number,
  command: string[],
  env: NodeJS.ProcessEnv = {},
  extraArgs: string[] = [],
): ChildProcess {
  return spawn('bash', hostLockArgs(name, timeoutSeconds, command, extraArgs), {
    env: hostLockEnv(home, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// macOS Bash 3.2 (`set -m`) can race the parent and forked child both calling
// setpgid under CPU load and print this warning. The process group is still
// established by the winner, and the warning is owned by the shell, not by
// with-host-lock, so assertions on the wrapper's own stderr drop it.
const benignJobControlWarning =
  /^.*: (?:child )?setpgid \(\d+ to \d+\): Operation not permitted\n/gm

export function completion(child: ChildProcess): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', reject)
    child.once('close', (code) =>
      resolve({ code, stderr: stderr.replace(benignJobControlWarning, '') }),
    )
  })
}

// Each wrapper runs a dozen short-lived subprocesses (stat, chmod, sed, date,
// a forked child) before it records owner.pgid. On a loaded CI runner that
// startup alone outlasted the old 5s deadline while the wrapper was still
// acquiring correctly (#969 run 45637724931). The deadline stays below the
// 30s test timeout so a path that never appears still fails with this error.
const pathWaitDeadlineMs = 20_000

// A test that awaits waitForPath `waits` times in sequence can spend the full
// deadline on each, so its Vitest timeout must exceed that sum plus the usual
// 30s for the rest of the test. Otherwise Vitest reports a generic timeout
// instead of the "Timed out waiting for <path>" error.
export function sequentialWaitsTimeoutMs(waits: number): number {
  return waits * pathWaitDeadlineMs + 30_000
}

export async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + pathWaitDeadlineMs
  while (Date.now() < deadline) {
    try {
      await stat(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

export async function cleanupTestHomes(): Promise<void> {
  await Promise.all(testHomes.splice(0).map((home) => rm(home, { force: true, recursive: true })))
}

export async function withFinalTimeoutProbe(
  home: string,
  assertProbe: ({
    lock,
    marker,
    contenderDone,
  }: {
    lock: string
    marker: string
    contenderDone: Promise<{ code: number | null; stderr: string }>
  }) => Promise<void>,
): Promise<void> {
  const lock = join(home, '.cache/host-lock/expensive-build.lock.d')
  const sleepBin = join(home, 'sleep-bin')
  const acquisitionWaitMarker = join(home, 'acquisition-wait-started')
  const acquisitionWaitRelease = join(home, 'acquisition-wait-release')
  const marker = join(home, 'ran')
  const acquireTimeoutS = 2
  const { stdout: realSleep } = await execFileAsync('which', ['sleep'])
  const owner = spawn(realSleep.trim(), ['30'], { stdio: 'ignore' })
  const ownerDone = completion(owner)
  let contender: ChildProcess | undefined
  let contenderDone: Promise<{ code: number | null; stderr: string }> | undefined

  try {
    if (owner.pid == null) throw new Error('Could not start final-timeout-probe owner.')
    await mkdir(lock, { recursive: true })
    await Promise.all([
      writeFile(join(lock, 'owner.pid'), `${owner.pid}\n`),
      writeFile(join(lock, 'owner.token'), 'live-owner\n'),
      mkdir(sleepBin),
    ])
    const sleepShim = join(sleepBin, 'sleep')
    await writeFile(
      sleepShim,
      String.raw`#!/usr/bin/env bash
if [ ! -f "$HOST_LOCK_ACQUISITION_WAIT_RELEASE" ] && [ "$#" -eq 1 ] && [[ "$1" =~ ^[0-9]*[1-9][0-9]*$ ]]; then
  : >"$HOST_LOCK_ACQUISITION_WAIT_MARKER"
  while [ ! -f "$HOST_LOCK_ACQUISITION_WAIT_RELEASE" ]; do
    "$HOST_LOCK_REAL_SLEEP" 0.02
  done
fi
exec "$HOST_LOCK_REAL_SLEEP" "$@"
`,
      { mode: 0o755 },
    )

    contender = spawnHostLock(home, 'expensive-build', acquireTimeoutS, ['touch', marker], {
      PATH: `${sleepBin}:${process.env.PATH ?? ''}`,
      HOST_LOCK_REAL_SLEEP: realSleep.trim(),
      HOST_LOCK_ACQUISITION_WAIT_MARKER: acquisitionWaitMarker,
      HOST_LOCK_ACQUISITION_WAIT_RELEASE: acquisitionWaitRelease,
    })
    const activeContenderDone = completion(contender)
    contenderDone = activeContenderDone
    await waitForPath(acquisitionWaitMarker)

    owner.kill('SIGTERM')
    await Promise.all([
      ownerDone,
      new Promise((resolve) => setTimeout(resolve, acquireTimeoutS * 1000 + 200)),
    ])
    await writeFile(acquisitionWaitRelease, '')

    const probe = { lock, marker, contenderDone: activeContenderDone }
    await assertProbe(probe)
  } finally {
    await writeFile(acquisitionWaitRelease, '').catch(() => undefined)
    owner.kill('SIGKILL')
    contender?.kill('SIGKILL')
    await Promise.all([ownerDone, ...(contenderDone ? [contenderDone] : [])])
  }
}
