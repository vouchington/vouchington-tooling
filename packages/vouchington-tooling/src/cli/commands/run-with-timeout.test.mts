import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = join(process.cwd(), 'packages/vouchington-tooling/scripts/gha/run-with-timeout.sh')

function runHelper(args: string[]) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8' })
}

describe('run-with-timeout', () => {
  it('rejects missing and non-positive durations', () => {
    expect(runHelper([]).status).toBe(2)
    expect(runHelper(['1']).status).toBe(2)
    expect(runHelper(['0', '1', 'true']).stdout + runHelper(['0', '1', 'true']).stderr).toContain(
      'timeout seconds must be a positive',
    )
    expect(runHelper(['1', '0', 'true']).stdout + runHelper(['1', '0', 'true']).stderr).toContain(
      'kill-after seconds must be a positive',
    )
    expect(runHelper(['abc', '1', 'true']).status).toBe(2)
  })

  it('runs a command that finishes before the deadline', () => {
    const result = runHelper(['5', '1', 'true'])
    expect(result.status).toBe(0)
    expect(result.stderr).not.toContain('publish-ecr-image')
  })

  it('times out a long-running command', () => {
    const result = runHelper(['1', '1', 'sleep', '30'])
    expect(result.status).not.toBe(0)
  })
})
