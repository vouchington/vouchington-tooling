import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runnerPortPolicy } from '../../runner-port-policy/index.mts'

const hostLockScriptPath = resolve(
  'packages/vouchington-tooling/scripts/host-lock/with-host-lock.sh',
)

// Slot `maximumRunnerSlot` is the fleet's established synthetic ceiling for boundary tests (see
// allocate-browser-safe-ports.test.mts's "uses the slot-50 boundary" case) — no host runs that
// many runner slots, so this range never collides with a real runner's live port allocation.
export const synthesizedRunnerSlot = runnerPortPolicy.maximumRunnerSlot
export const synthesizedPortRangeStart =
  runnerPortPolicy.reservedPortStart +
  (synthesizedRunnerSlot - runnerPortPolicy.minimumRunnerSlot) * runnerPortPolicy.portsPerRunner
export const synthesizedPortRangeEnd =
  synthesizedPortRangeStart + runnerPortPolicy.portsPerRunner - 1

export function requiredPort(port: number | undefined): number {
  if (port === undefined) throw new Error('expected an allocated port')
  return port
}

const hostLockName = 'allocate-browser-safe-ports-synthesized-slot'
const hostLockTimeoutSeconds = 60
const hostLockCommandTimeoutSeconds = 60
// Grace this wrapper waits past with-host-lock.sh's own --timeout-seconds before giving up on the
// acquired marker (mirrors the script's internal polling/teardown overhead around acquisition).
const hostLockAcquireGraceSeconds = 15
// Fixed overhead for this wrapper's own teardown once body() returns: writing the release marker,
// waiting for the placeholder to exit, and removing the marker dir.
const hostLockWrapperTeardownMarginSeconds = 15

// Single source of truth for how long a vitest `it()` calling withSynthesizedSlotHostLock must be
// allowed to run: the full lock-acquisition window, then a critical section that may legitimately
// run right up to with-host-lock's own --command-timeout-seconds watchdog, plus fixed wrapper
// teardown. Deriving this -- instead of a second, independent literal on the `it()` call -- is what
// guarantees with-host-lock's watchdog can never force-release the lock while the calling test
// still believes it's within its own timeout budget: with-host-lock.sh's
// start_command_timeout_watchdog force-kills the placeholder and unconditionally releases the lock
// once command_timeout_seconds elapses, regardless of whether body() has finished, so the vitest
// timeout must always exceed that watchdog's own worst case, never fall short of it.
export const synthesizedSlotHostLockTestTimeoutMs =
  (hostLockTimeoutSeconds +
    hostLockAcquireGraceSeconds +
    hostLockCommandTimeoutSeconds +
    hostLockWrapperTeardownMarginSeconds) *
  1000

async function waitForMarker(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for marker: ${path}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
}

// ci/with-host-lock.sh only wraps a subprocess command, but the racy resource here (binding real
// host ports) is in-process Node.js code. The wrapped command is therefore a placeholder that
// writes an "acquired" marker the instant it starts running — which is exactly when the lock is
// held, per with-host-lock.sh's start-release handshake — and blocks on a "release" marker until
// told to stop. That gates the Node-side critical section on lock acquisition/release instead of
// trying to run that section as the locked subprocess itself, so two concurrent copies of a test
// using the synthesized slot take turns instead of colliding on the same synthetic port range.
export async function withSynthesizedSlotHostLock<T>(body: () => Promise<T>): Promise<T> {
  const markerDir = await mkdtemp(join(tmpdir(), 'host-lock-marker-'))
  const acquiredMarker = join(markerDir, 'acquired')
  const releaseMarker = join(markerDir, 'release')
  const stderrChunks: Buffer[] = []
  const holder = spawn(
    'bash',
    [
      hostLockScriptPath,
      '--name',
      hostLockName,
      '--timeout-seconds',
      String(hostLockTimeoutSeconds),
      '--command-timeout-seconds',
      String(hostLockCommandTimeoutSeconds),
      '--',
      'bash',
      '-c',
      'touch "$1"; while [ ! -e "$2" ]; do sleep 0.05; done',
      '_',
      acquiredMarker,
      releaseMarker,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  holder.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
  const exited = new Promise<number | null>((resolveExit) => {
    holder.once('close', (code) => resolveExit(code))
  })

  const acquireTimeoutMs = (hostLockTimeoutSeconds + hostLockAcquireGraceSeconds) * 1000
  const acquired = await Promise.race([
    waitForMarker(acquiredMarker, acquireTimeoutMs).then(() => true as const),
    exited.then(() => false as const),
  ])
  if (!acquired) {
    const code = await exited
    throw new Error(
      `with-host-lock exited before acquiring "${hostLockName}" (code ${code}): ${Buffer.concat(
        stderrChunks,
      ).toString('utf8')}`,
    )
  }

  try {
    return await body()
  } finally {
    await releasePlaceholderAndAwaitExit(releaseMarker, exited)
    await rm(markerDir, { force: true, recursive: true })
  }
}

async function releasePlaceholderAndAwaitExit(
  releaseMarker: string,
  exited: Promise<number | null>,
): Promise<void> {
  await writeFile(releaseMarker, '')
  await exited
}
