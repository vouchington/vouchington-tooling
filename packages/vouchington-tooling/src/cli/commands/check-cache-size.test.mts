import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parseGithubOutput } from './github-output.test-helpers.mts'

const script = join(process.cwd(), 'packages/vouchington-tooling/scripts/gha/check-cache-size.sh')
const temporaryDirectories: string[] = []

function runHelper(args: string[], githubOutput?: string) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'check-cache-size-'))
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

describe('check-cache-size', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('writes save=false for a missing path', () => {
    const result = runHelper([join(tmpdir(), 'missing-cache-path'), '1024', 'tool cache'])
    expect(result.status).toBe(0)
    expect(result.output).toEqual({ bytes: '0', save: 'false' })
    expect(result.stdout).toContain('does not exist')
  })

  it('writes save=true when the path is under the byte cap', () => {
    const directory = mkdtempSync(join(tmpdir(), 'check-cache-size-path-'))
    temporaryDirectories.push(directory)
    writeFileSync(join(directory, 'keep.txt'), 'ok\n')
    const result = runHelper([directory, '104857600', 'tool cache'])
    expect(result.status).toBe(0)
    expect(result.output?.save).toBe('true')
    expect(Number(result.output?.bytes)).toBeGreaterThan(0)
  })

  it('writes save=false when the path exceeds the byte cap', () => {
    const directory = mkdtempSync(join(tmpdir(), 'check-cache-size-path-'))
    temporaryDirectories.push(directory)
    mkdirSync(join(directory, 'nested'))
    writeFileSync(join(directory, 'nested', 'keep.txt'), 'ok\n')
    const result = runHelper([directory, '1', 'tool cache'])
    expect(result.status).toBe(0)
    expect(result.output?.save).toBe('false')
    expect(result.stdout).toContain('Skipping tool cache cache save')
  })

  it('rejects invalid arguments and a missing output path', () => {
    expect(runHelper([]).status).toBe(2)
    expect(runHelper(['path', '1']).stderr).toContain('usage:')
    expect(runHelper(['path', '0', 'label']).status).toBe(1)
    expect(runHelper(['path', '0', 'label']).stdout).toContain('positive integer')
    expect(runHelper(['path', '8', 'label'], '').status).toBe(2)
    expect(runHelper(['path', '8', 'label'], '').stderr).toContain('GITHUB_OUTPUT must be set')
  })
})
