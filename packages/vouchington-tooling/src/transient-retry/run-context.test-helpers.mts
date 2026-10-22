import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createGhApi } from './gh-api.mts'
import { DEFAULT_LOG_LIMITS, type LogLimits } from './log-window.mts'
import type { RunFetchEnv } from './run-context-types.mts'

/** `[substring of the joined gh argv, reply]`; the first matching route wins. */
export type Route = [match: string, reply: string | Error]
/** Streamed log per `/jobs/<id>/logs` suffix: one string, several chunks, or a failure. */
export type LogReply = string | string[] | Error

export const jobsPage = (...jobs: Array<Record<string, unknown>>): string =>
  JSON.stringify([{ jobs }])

export const runReply = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ conclusion: 'failure', name: 'CI', run_attempt: 1, ...overrides })

export function createFakeEnv(
  routes: Route[],
  logs: Record<string, LogReply> = {},
  limits: Partial<LogLimits> = {},
) {
  const calls: string[][] = []
  const streamed: string[] = []
  const api = createGhApi({
    run: async (args) => {
      calls.push(args)
      const joined = args.join(' ')
      const route = routes.find(([match]) => joined.includes(match))
      if (route === undefined) throw new Error(`unrouted gh call: ${joined}`)
      if (route[1] instanceof Error) throw route[1]
      return route[1]
    },
    sleep: async () => undefined,
    warn: () => undefined,
  })
  const env: RunFetchEnv = {
    api,
    limits: { ...DEFAULT_LOG_LIMITS, ...limits },
    repository: 'acme/widgets',
    runId: '123',
    streamLog: async function* (path) {
      streamed.push(path)
      const key = Object.keys(logs).find((suffix) => path.endsWith(suffix))
      if (key === undefined) throw new Error(`unrouted log stream: ${path}`)
      const reply = logs[key]!
      if (reply instanceof Error) throw reply
      for (const chunk of Array.isArray(reply) ? reply : [reply]) yield Buffer.from(chunk)
    },
  }
  return { api, calls, env, streamed }
}

/** Installs a POSIX `gh` stub first on PATH. Returns the restore function. */
export function installFakeGh(script: string): () => void {
  const directory = mkdtempSync(join(tmpdir(), 'fake-gh-'))
  const file = join(directory, 'gh')
  writeFileSync(file, `#!/bin/sh\n${script}\n`)
  chmodSync(file, 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${directory}:${previous ?? ''}`
  return () => {
    process.env.PATH = previous
    rmSync(directory, { recursive: true, force: true })
  }
}
