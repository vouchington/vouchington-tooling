import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

const path = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/setup-aws/action.yml',
)
const source = readFileSync(path, 'utf8')
const action = load(source) as {
  inputs: Record<string, { default?: string; required?: boolean }>
  runs: { using: string; steps: Array<{ uses?: string; with?: Record<string, string> }> }
}

describe('setup-aws composite action', () => {
  it('requires only the role ARN and defaults the region and timeout', () => {
    expect(action.runs.using).toBe('composite')
    expect(Object.keys(action.inputs)).toEqual(['role-arn', 'aws-region', 'action-timeout-s'])
    expect(action.inputs['role-arn']?.required).toBe(true)
    expect(action.inputs['aws-region']?.default).toBe('us-east-1')
    expect(action.inputs['action-timeout-s']?.default).toBe('90')
    expect(source).not.toMatch(/vouchington|voucha/iu)
  })

  it('wraps a SHA-pinned configure-aws-credentials with the inputs', () => {
    expect(action.runs.steps).toHaveLength(1)
    const [wrapped] = action.runs.steps
    expect(wrapped?.uses).toMatch(/^aws-actions\/configure-aws-credentials@[0-9a-f]{40}$/)
    expect(wrapped?.with).toEqual({
      'role-to-assume': '${{ inputs.role-arn }}',
      'aws-region': '${{ inputs.aws-region }}',
      'action-timeout-s': '${{ inputs.action-timeout-s }}',
    })
  })
})
