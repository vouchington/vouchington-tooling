import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parseGithubOutput } from './github-output.test-helpers.mts'

const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/harness-admission-lane.sh',
)
const temporaryDirectories: string[] = []

function runHelper(args: string[], env: NodeJS.ProcessEnv = {}) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'harness-admission-lane-'))
  temporaryDirectories.push(temporaryDirectory)
  const outputPath = join(temporaryDirectory, 'github-output')
  const spawnEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_OUTPUT: outputPath,
    GITHUB_RUN_ID: '1234',
    ...env,
  }
  if (env.GITHUB_OUTPUT === '') delete spawnEnv.GITHUB_OUTPUT
  if (env.GITHUB_RUN_ID === '') delete spawnEnv.GITHUB_RUN_ID
  const result = spawnSync('bash', [script, ...args], { encoding: 'utf8', env: spawnEnv })
  return {
    ...result,
    output: result.status === 0 ? parseGithubOutput(readFileSync(outputPath, 'utf8')) : undefined,
  }
}

describe('harness-admission-lane', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('computes GITHUB_RUN_ID modulo the lane count', () => {
    expect(runHelper(['4'], { GITHUB_RUN_ID: '10' }).output).toEqual({ lane: '2' })
    expect(runHelper(['4'], { GITHUB_RUN_ID: '8' }).output).toEqual({ lane: '0' })
    expect(runHelper(['1'], { GITHUB_RUN_ID: '999' }).output).toEqual({ lane: '0' })
  })

  it('rejects invalid arguments and a missing output path', () => {
    expect(runHelper([]).status).toBe(2)
    expect(runHelper(['4', '5']).stderr).toContain('usage:')
    expect(runHelper(['4'], { GITHUB_OUTPUT: '' }).status).toBe(2)
    expect(runHelper(['4'], { GITHUB_OUTPUT: '' }).stderr).toContain('GITHUB_OUTPUT must be set')
  })

  it('rejects an invalid lane count', () => {
    expect(runHelper(['0']).status).toBe(1)
    expect(runHelper(['0']).stdout).toContain('positive integer')
    expect(runHelper(['abc']).status).toBe(1)
  })

  it('rejects a missing or non-numeric GITHUB_RUN_ID', () => {
    expect(runHelper(['4'], { GITHUB_RUN_ID: '' }).status).toBe(1)
    expect(runHelper(['4'], { GITHUB_RUN_ID: '' }).stdout).toContain('GITHUB_RUN_ID')
    expect(runHelper(['4'], { GITHUB_RUN_ID: 'abc' }).status).toBe(1)
  })
})
