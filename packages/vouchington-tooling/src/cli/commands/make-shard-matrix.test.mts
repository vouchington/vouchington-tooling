import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parseGithubOutput } from './github-output.test-helpers.mts'

const script = join(process.cwd(), 'packages/vouchington-tooling/scripts/gha/make-shard-matrix.sh')
const temporaryDirectories: string[] = []

function runHelper(args: string[], githubOutput?: string) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'make-shard-matrix-'))
  temporaryDirectories.push(temporaryDirectory)
  const outputPath = githubOutput ?? join(temporaryDirectory, 'github-output')
  const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: outputPath }
  if (githubOutput === '') delete env.GITHUB_OUTPUT
  const result = spawnSync('bash', [script, ...args], { encoding: 'utf8', env })
  return {
    ...result,
    output: result.status === 0 ? parseGithubOutput(readFileSync(outputPath, 'utf8')) : undefined,
  }
}

describe('make-shard-matrix', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('writes a validated total and JSON shard matrix', () => {
    expect(runHelper(['1']).output).toEqual({ total: '1', matrix: '[1]' })
    expect(runHelper(['3']).output).toEqual({ total: '3', matrix: '[1,2,3]' })
  })

  it('rejects invalid arguments and a missing output path', () => {
    expect(runHelper([]).status).toBe(2)
    expect(runHelper(['1', '2']).stderr).toContain('usage:')
    expect(runHelper(['0']).status).toBe(1)
    expect(runHelper(['abc']).stdout).toContain('positive integer')
    expect(runHelper(['2'], '').status).toBe(2)
    expect(runHelper(['2'], '').stderr).toContain('GITHUB_OUTPUT must be set')
  })
})
