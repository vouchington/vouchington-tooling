import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Step = { run?: string; env?: Record<string, string>; uses?: string; with?: object }

const path = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/upload-full-lcov/action.yml',
)
const source = readFileSync(path, 'utf8')
const action = load(source) as {
  inputs: Record<string, { default?: string; required?: boolean }>
  runs: { using: string; steps: Step[] }
}
const [validate, upload] = action.runs.steps
const script = validate?.run ?? ''

function check(suite: string) {
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SUITE: suite, LC_ALL: 'C' },
  })
}

describe('upload-full-lcov composite action', () => {
  it('is a composite action that requires only the suite', () => {
    expect(action.runs.using).toBe('composite')
    expect(Object.keys(action.inputs)).toEqual(['suite', 'name-suffix', 'path'])
    expect(action.inputs.suite?.required).toBe(true)
    expect(action.inputs['name-suffix']?.default).toBe('')
    expect(action.inputs.path?.default).toBe('coverage-full/lcov.info')
    expect(source).not.toMatch(/vouchington|voucha/iu)
  })

  it('passes the suite through env, never inline in the script', () => {
    expect(validate?.env).toMatchObject({ SUITE: '${{ inputs.suite }}' })
    expect(script).not.toContain('${{')
  })

  it('uploads the report as an overwriting, SHA-pinned lcov-full artifact', () => {
    expect(upload?.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/)
    expect(upload?.with).toEqual({
      overwrite: true,
      name: 'lcov-full-${{ inputs.suite }}${{ inputs.name-suffix }}',
      path: '${{ inputs.path }}',
      'retention-days': 1,
      'if-no-files-found': 'error',
    })
  })

  it.each(['web', 'api-v2', 'a1-b2-c3', 'retryer'])('accepts the suite %s', (suite) => {
    expect(check(suite).status).toBe(0)
  })

  it.each(['', '-web', 'web-', 'web--api', 'Web', 'web_api', 'web.api', 'retry', 'web-retry'])(
    'rejects the suite "%s"',
    (suite) => {
      const result = check(suite)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Invalid coverage suite')
    },
  )
})
