import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const directory = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/resolve-pnpm-version',
)
const script = join(directory, 'resolve.mjs')
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

function run(env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn('node', [script], { env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk))
    child.on('close', (code) => done({ code, stdout, stderr }))
  })
}

async function resolveFrom(packument: unknown, status = 200) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(packument))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as { port: number }
  const output = join(mkdtempSync(join(tmpdir(), 'resolve-pnpm-')), 'output')
  const result = await run({
    PNPM_REGISTRY_URL: `http://127.0.0.1:${port}/pnpm`,
    GITHUB_OUTPUT: output,
  })
  server.close()
  let written = ''
  try {
    written = readFileSync(output, 'utf8')
  } catch {
    written = ''
  }
  return { ...result, written }
}

describe('resolve-pnpm-version action', () => {
  it('runs the resolver script with the major and age inputs', () => {
    const action = parse(readFileSync(join(directory, 'action.yml'), 'utf8')) as {
      outputs: { version: { value: string } }
      runs: { steps: { env: Record<string, string>; run: string }[] }
    }
    expect(action.outputs.version.value).toBe('${{ steps.resolve.outputs.version }}')
    expect(action.runs.steps[0]?.run).toBe('node "$GITHUB_ACTION_PATH/resolve.mjs"')
    expect(action.runs.steps[0]?.env).toEqual({
      PNPM_MAJOR: '${{ inputs.major }}',
      MIN_AGE_HOURS: '${{ inputs.min-age-hours }}',
    })
  })

  it('picks the highest stable 12.x release that is at least a day old', async () => {
    const result = await resolveFrom({
      versions: {
        '11.9.0': {},
        '12.9.0': {},
        '12.10.0': {},
        '12.11.0': {},
        '12.12.0-rc.1': {},
        '12.13.0': {},
      },
      time: {
        '11.9.0': hoursAgo(900),
        '12.9.0': hoursAgo(300),
        '12.10.0': hoursAgo(48),
        '12.11.0': hoursAgo(25),
        '12.12.0-rc.1': hoursAgo(30),
        '12.13.0': hoursAgo(2),
      },
    })
    expect(result.code).toBe(0)
    expect(result.written).toBe('version=12.11.0\n')
    expect(result.stdout).toContain('Resolved pnpm 12.11.0')
  })

  it('fails clearly when no release qualifies', async () => {
    const result = await resolveFrom({
      versions: { '12.1.0': {} },
      time: { '12.1.0': hoursAgo(1) },
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('No stable pnpm 12.x release is at least 24h old.')
    expect(result.written).toBe('')
  })

  it('fails on a registry error without retrying', async () => {
    const result = await resolveFrom({}, 503)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('responded 503')
  })

  it('fails when the registry is unreachable', () => {
    const failed = spawnSync('node', [script], {
      env: { ...process.env, PNPM_REGISTRY_URL: 'http://127.0.0.1:1/pnpm' },
      encoding: 'utf8',
    })
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('Could not fetch')
  })
})
