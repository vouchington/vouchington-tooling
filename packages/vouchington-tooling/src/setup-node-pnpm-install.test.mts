import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const script = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/setup-node-pnpm/install.mjs',
)
const { buildArgs, parseOptions, FETCH_FLAGS } = (await import(script)) as {
  buildArgs: (attempt: number, ignoreScripts: boolean) => string[]
  parseOptions: (env: Record<string, string | undefined>) => {
    timeoutSeconds: number
    attempts: number
    ignoreScripts: boolean
    graceMs: number
  }
  FETCH_FLAGS: string[]
}

// A fake pnpm that records its arguments and then acts out one behavior per call:
// ok, fail (exit 7), hang (sleep), or stubborn (ignore SIGTERM and sleep).
const fakePnpm = `#!/bin/sh
echo "$@" >> "$FAKE_LOG"
n=$(wc -l < "$FAKE_LOG" | tr -d ' ')
mode=$(echo "$FAKE_BEHAVIOR" | cut -d, -f"$n")
case "$mode" in
  ok) exit 0 ;;
  fail) exit 7 ;;
  stubborn) trap '' TERM; while :; do sleep 1; done ;;
  *) sleep 30 & wait ;;
esac
`

async function install(behavior: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-pnpm-'))
  const log = join(dir, 'log')
  writeFileSync(log, '')
  writeFileSync(join(dir, 'pnpm'), fakePnpm)
  chmodSync(join(dir, 'pnpm'), 0o755)
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (done) => {
      const child = spawn(process.execPath, [script], {
        env: {
          ...process.env,
          PATH: `${dir}${delimiter}${process.env.PATH}`,
          FAKE_LOG: log,
          FAKE_BEHAVIOR: behavior,
          INSTALL_ATTEMPT_TIMEOUT_SECONDS: '1',
          ...env,
        },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk))
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk))
      child.on('close', (code) => done({ code, stdout, stderr }))
    },
  )
  const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
  return { ...result, calls }
}

describe('setup-node-pnpm install options', () => {
  it('defaults to a 150s limit, 2 attempts, and scripts enabled', () => {
    expect(parseOptions({})).toEqual({
      timeoutSeconds: 150,
      attempts: 2,
      ignoreScripts: false,
      graceMs: 10_000,
    })
    expect(parseOptions({ INSTALL_ATTEMPTS: ' ', INSTALL_IGNORE_SCRIPTS: 'true' })).toMatchObject({
      attempts: 2,
      ignoreScripts: true,
    })
  })

  it.each(['0', '-1', '1.5', 'abc', '1e3'])('rejects %s as a positive integer', (value) => {
    expect(() => parseOptions({ INSTALL_ATTEMPTS: value })).toThrow(/install-attempts/u)
    expect(() => parseOptions({ INSTALL_ATTEMPT_TIMEOUT_SECONDS: value })).toThrow(
      /install-attempt-timeout-seconds/u,
    )
  })

  it('builds quiet first-attempt args and append-only info retry args', () => {
    expect(FETCH_FLAGS).toEqual([
      '--fetch-timeout=15000',
      '--config.fetch-retries=3',
      '--config.fetch-retry-mintimeout=1000',
      '--config.fetch-retry-maxtimeout=5000',
    ])
    expect(buildArgs(1, false)).toEqual([
      'install',
      '--frozen-lockfile',
      ...FETCH_FLAGS,
      '--loglevel=warn',
    ])
    expect(buildArgs(2, false)).toEqual([
      'install',
      '--frozen-lockfile',
      ...FETCH_FLAGS,
      '--reporter=append-only',
      '--loglevel=info',
    ])
    expect(buildArgs(1, true)).toContain('--ignore-scripts')
    expect(buildArgs(2, false)).not.toContain('--ignore-scripts')
  })
})

describe('setup-node-pnpm install.mjs', () => {
  it('runs once and passes the exit code through on success', async () => {
    const result = await install('ok', { INSTALL_IGNORE_SCRIPTS: 'true' })
    expect(result).toMatchObject({ code: 0 })
    expect(result.calls).toEqual([buildArgs(1, true).join(' ')])
  })

  it('does not retry a non-timeout failure', async () => {
    const result = await install('fail,ok')
    expect(result.code).toBe(7)
    expect(result.calls).toHaveLength(1)
    expect(result.stdout).not.toContain('::warning::')
  })

  it('kills a hung attempt, warns, and retries with retry logging', async () => {
    const result = await install('hang,ok')
    expect(result.code).toBe(0)
    expect(result.calls).toEqual([buildArgs(1, false).join(' '), buildArgs(2, false).join(' ')])
    expect(result.stdout).toMatch(
      /::warning::pnpm install attempt 1\/2 timed out after \d+s; retrying/u,
    )
  })

  it('fails with an error after the final attempt times out', async () => {
    const result = await install('hang,hang')
    expect(result.code).toBe(1)
    expect(result.calls).toHaveLength(2)
    expect(result.stderr).toMatch(
      /::error::pnpm install attempt 2\/2 timed out after \d+s; giving up/u,
    )
  })

  it('escalates to SIGKILL when pnpm ignores SIGTERM', async () => {
    const result = await install('stubborn', {
      INSTALL_ATTEMPTS: '1',
      INSTALL_KILL_GRACE_MS: '200',
    })
    expect(result.code).toBe(1)
    expect(result.calls).toHaveLength(1)
  })

  it('fails clearly on invalid input before running pnpm', async () => {
    const result = await install('ok', { INSTALL_ATTEMPTS: 'zero' })
    expect(result.code).toBe(1)
    expect(result.calls).toEqual([])
    expect(result.stderr).toContain('::error::install-attempts must be a positive integer')
  })

  it('reports a pnpm that cannot be started', async () => {
    const result = await install('ok', { PATH: '/nonexistent' })
    expect(result.code).toBe(127)
    expect(result.stderr).toContain('::error::Could not start pnpm')
  })
})
