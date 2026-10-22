import { execFile } from 'node:child_process'
import { setTimeout as sleepFor } from 'node:timers/promises'
import { promisify } from 'node:util'

import { ghSpawnEnv } from '../gh-cli/env.mts'
import { createCommandRunner, type RunTextCommand } from '../gh-cli/exec.mts'

const execFileAsync = promisify(execFile)

/** Substrings of a failed `gh` call that mark a transport hiccup worth retrying. */
export const DEFAULT_RETRYABLE_MARKERS: readonly string[] = [
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'connection reset',
  'TLS handshake timeout',
  'unexpected EOF',
  'HTTP 502',
  'HTTP 503',
  'HTTP 504',
]

/** The largest stdout one buffered `gh api` call may return; job logs are streamed, not buffered. */
export const API_MAX_BUFFER_BYTES = 16 * 1024 * 1024

export interface GhApiOptions {
  /** Runs `gh` with the given argv and returns stdout. Defaults to {@link createGhRunner}. */
  run?: RunTextCommand
  attempts?: number
  retryableMarkers?: readonly string[]
  sleep?: (ms: number) => Promise<void>
  warn?: (message: string) => void
}

export interface GhApi {
  /** `gh api <args>` with bounded retries on transport errors. Resolves to stdout. */
  call: (args: string[]) => Promise<string>
  isRetryable: (error: unknown) => boolean
  sleep: (ms: number) => Promise<void>
  /** Runs an arbitrary `gh` argv once, without retries. */
  run: RunTextCommand
}

/**
 * Builds the default `gh` runner. `tokenEnv` names the environment variable that holds the
 * token; when set and present it is passed to `gh` as `GH_TOKEN`. Otherwise `gh` uses its own
 * credentials.
 */
export function createGhRunner(tokenEnv?: string): RunTextCommand {
  return createCommandRunner(
    'gh',
    (command, args, options) =>
      execFileAsync(command, args, {
        ...options,
        encoding: 'utf8',
        maxBuffer: API_MAX_BUFFER_BYTES,
      }),
    (env) => {
      const base = ghSpawnEnv(env)
      const token = tokenEnv === undefined ? undefined : env[tokenEnv]
      return token ? { ...base, GH_TOKEN: token } : base
    },
  )
}

function errorText(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr
  const message = error instanceof Error ? error.message : String(error)
  return typeof stderr === 'string' ? `${message}\n${stderr}` : message
}

export function createGhApi({
  run = createGhRunner(),
  attempts = 3,
  retryableMarkers = DEFAULT_RETRYABLE_MARKERS,
  sleep = (ms) => sleepFor(ms),
  warn = (message) => console.error(message),
}: GhApiOptions = {}): GhApi {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`Invalid gh api retry attempts: ${attempts}`)
  }
  const isRetryable = (error: unknown): boolean => {
    const text = errorText(error)
    return retryableMarkers.some((marker) => text.includes(marker))
  }
  const call = async (args: string[]): Promise<string> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run(['api', ...args])
      } catch (error) {
        if (attempt >= attempts || !isRetryable(error)) throw error
        warn(`::warning::gh api attempt ${attempt}/${attempts} failed; retrying`)
        await sleep(attempt * 1000)
      }
    }
  }
  return { call, isRetryable, sleep, run }
}
