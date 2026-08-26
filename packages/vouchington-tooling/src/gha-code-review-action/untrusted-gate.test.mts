import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

const validator = resolve('.github/actions/ci-untrusted-code-reviewed/validate-context.sh')
const action = load(
  readFileSync('.github/actions/ci-untrusted-code-reviewed/action.yml', 'utf8'),
) as {
  runs?: { steps?: Array<{ env?: Record<string, string>; run?: string }> }
}

describe('CI untrusted code-reviewed gate', () => {
  it('validates the context before either conditional branch', () => {
    expect(action.runs?.steps?.at(0)).toMatchObject({
      env: { TRUSTED_SECRET_CONTEXT: '${{ inputs.trusted-secret-context }}' },
      run: 'bash "$GITHUB_ACTION_PATH/validate-context.sh"',
    })
  })

  it.each(['true', 'false'])('accepts the exact boolean context %s', (context) => {
    const result = spawnSync('bash', [validator], {
      env: { TRUSTED_SECRET_CONTEXT: context },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
  })

  it.each(['', 'TRUE', '1', 'unknown'])('rejects the invalid context %s', (context) => {
    const result = spawnSync('bash', [validator], {
      env: { TRUSTED_SECRET_CONTEXT: context },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('trusted-secret-context must be exactly true or false')
  })
})
