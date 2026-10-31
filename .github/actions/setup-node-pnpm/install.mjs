// Runs `pnpm install --frozen-lockfile` with tight fetch settings, a wall-clock limit per
// attempt inside one total deadline, and a retry when an attempt times out. A non-timeout failure is never retried.
// Node >= 24, no dependencies, no GNU `timeout` (macOS runners have none).
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { deadlineMessage, parseDeadline, registryHost } from './deadline.mjs'

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

// A retry starts only when at least this much of the total budget remains for it.
export const MIN_ATTEMPT_MS = 30_000

// Each attempt gets min(per-attempt limit, remaining budget minus the kill grace), so the
// attempt and its kill grace together never run past the total deadline.
export function attemptLimitMs(options, deadline, now) {
  return Math.min(options.timeoutSeconds * 1000, deadline.endMs - now - options.graceMs)
}

// Attempt 1 needs any positive budget; a retry needs a meaningful one (a shorter per-attempt
// limit lowers the bar so the retry is never required to be longer than a normal attempt).
export function minimumMs(options, attempt) {
  return attempt === 1 ? 1 : Math.min(MIN_ATTEMPT_MS, options.timeoutSeconds * 1000)
}

export async function main(env = process.env, clock = Date.now, run = runAttempt) {
  let options
  let deadline
  try {
    options = parseOptions(env)
    deadline = parseDeadline(env, clock())
  } catch (error) {
    console.error(`::error::${error.message}`)
    return 1
  }
  const expired = () => {
    const host = registryHost(env)
    console.error(`::error::${deadlineMessage(deadline.seconds, 'pnpm install', host)}`)
    return 1
  }
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    const started = clock()
    const limitMs = attemptLimitMs(options, deadline, started)
    if (limitMs < minimumMs(options, attempt)) return expired()
    const result = await run(buildArgs(attempt, options.ignoreScripts), limitMs, options.graceMs)
    if (!result.timedOut) return result.code
    const elapsed = Math.round((clock() - started) / 1000)
    const note = `pnpm install attempt ${attempt}/${options.attempts} timed out after ${elapsed}s`
    if (limitMs < options.timeoutSeconds * 1000) return expired()
    if (attempt === options.attempts) {
      console.error(`::error::${note}; giving up`)
      return 1
    }
    console.log(`::warning::${note}; retrying`)
  }
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main()
