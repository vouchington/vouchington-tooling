import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = join(
  process.cwd(),
  'packages/vouchington-tooling/scripts/gha/harness-assert-gates.sh',
)

function runHelper(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

describe('harness-assert-gates', () => {
  it('requires at least one gate name', () => {
    const result = runHelper([])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })

  it('rejects an invalid gate name without indirect-expanding it', () => {
    const result = runHelper(['HARNESS_OK', '$(echo pwned)'])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('invalid gate name')
  })

  it('passes when every named gate is unset, empty, or not "true"', () => {
    const result = runHelper(['HARNESS_UNSET_GATE', 'HARNESS_EMPTY_GATE', 'HARNESS_FALSE_GATE'], {
      HARNESS_EMPTY_GATE: '',
      HARNESS_FALSE_GATE: 'false',
    })
    expect(result.status).toBe(0)
  })

  it('fails with ::error:: when any named gate is "true"', () => {
    const result = runHelper(['HARNESS_DISPATCH_ENABLED', 'HARNESS_SHEPHERD_ENABLED'], {
      HARNESS_DISPATCH_ENABLED: 'false',
      HARNESS_SHEPHERD_ENABLED: 'true',
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('::error::HARNESS_SHEPHERD_ENABLED must be disabled')
  })
})
