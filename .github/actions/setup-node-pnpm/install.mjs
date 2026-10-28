// Runs `pnpm install --frozen-lockfile` with tight fetch settings, a wall-clock limit per
// attempt, and a retry when an attempt times out. A non-timeout failure is never retried.
// Node >= 24, no dependencies, no GNU `timeout` (macOS runners have none).
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// pnpm 12 accepts only --fetch-timeout as a flag; the retry settings go through --config.*.
export const FETCH_FLAGS = [
  '--fetch-timeout=15000',
  '--config.fetch-retries=3',
  '--config.fetch-retry-mintimeout=1000',
  '--config.fetch-retry-maxtimeout=5000',
]

// setTimeout fires immediately for delays above this.
export const MAX_TIMER_MS = 2_147_483_647

function positiveInteger(name, raw, fallback, max = Number.MAX_SAFE_INTEGER) {
  const text = (raw ?? '').trim() || fallback
  if (!/^[1-9]\d*$/u.test(text)) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`)
  }
  const value = Number(text)
  if (value > max) throw new Error(`${name} must be at most ${max}, got "${raw}"`)
  return value
}

export function parseOptions(env) {
  return {
    timeoutSeconds: positiveInteger(
      'install-attempt-timeout-seconds',
      env.INSTALL_ATTEMPT_TIMEOUT_SECONDS,
      '150',
      Math.floor(MAX_TIMER_MS / 1000),
    ),
    attempts: positiveInteger('install-attempts', env.INSTALL_ATTEMPTS, '2'),
    ignoreScripts: env.INSTALL_IGNORE_SCRIPTS === 'true',
    graceMs: positiveInteger('kill grace ms', env.INSTALL_KILL_GRACE_MS, '10000', MAX_TIMER_MS),
  }
}

// Attempt 1 stays quiet; retries stream append-only info logs to show where a stall happened.
export function buildArgs(attempt, ignoreScripts) {
  return [
    'install',
    '--frozen-lockfile',
    ...(ignoreScripts ? ['--ignore-scripts'] : []),
    ...FETCH_FLAGS,
    ...(attempt === 1 ? ['--loglevel=warn'] : ['--reporter=append-only', '--loglevel=info']),
  ]
}

// Terminates the whole process tree: taskkill on Windows, the process group elsewhere.
export function makeKiller(platform = process.platform, run = spawnSync) {
  return (pid, signal) => {
    try {
      if (platform === 'win32') {
        run('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        process.kill(-pid, signal)
      }
    } catch {
      // The process or group is already gone.
    }
  }
}

export function runAttempt(
  args,
  timeoutMs,
  graceMs,
  platform = process.platform,
  kill = makeKiller(platform),
) {
  return new Promise((resolve) => {
    // detached opens a new console on Windows; elsewhere it makes a killable process group.
    const child = spawn('pnpm', args, { stdio: 'inherit', detached: platform !== 'win32' })
    let timedOut = false
    let killTimer
    const timer = setTimeout(() => {
      timedOut = true
      kill(child.pid, 'SIGTERM')
      killTimer = setTimeout(() => kill(child.pid, 'SIGKILL'), graceMs)
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      console.error(`::error::Could not start pnpm: ${error.message}`)
      resolve({ timedOut: false, code: 127 })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      if (timedOut) kill(child.pid, 'SIGKILL')
      resolve({ timedOut, code: code ?? (signal ? 1 : 0) })
    })
  })
}

export async function main(env = process.env) {
  let options
  try {
    options = parseOptions(env)
  } catch (error) {
    console.error(`::error::${error.message}`)
    return 1
  }
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    const started = Date.now()
    const result = await runAttempt(
      buildArgs(attempt, options.ignoreScripts),
      options.timeoutSeconds * 1000,
      options.graceMs,
    )
    if (!result.timedOut) return result.code
    const elapsed = Math.round((Date.now() - started) / 1000)
    const note = `pnpm install attempt ${attempt}/${options.attempts} timed out after ${elapsed}s`
    if (attempt === options.attempts) {
      console.error(`::error::${note}; giving up`)
      return 1
    }
    console.log(`::warning::${note}; retrying`)
  }
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main()
