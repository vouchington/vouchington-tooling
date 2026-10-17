import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Action = {
  inputs: Record<string, { required?: boolean }>
  runs: {
    using: string
    steps: Array<{ shell?: string; env?: Record<string, string>; run?: string }>
  }
}

const path = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/comment-harness-session/action.yml',
)
const source = readFileSync(path, 'utf8')
const action = load(source) as Action
const script = action.runs.steps[0]?.run ?? ''

describe('comment-harness-session action', () => {
  it('is a composite action with the three required inputs', () => {
    expect(action.runs.using).toBe('composite')
    expect(Object.keys(action.inputs)).toEqual(['target', 'session-id', 'session-url'])
    for (const input of Object.values(action.inputs)) expect(input.required).toBe(true)
  })

  it('posts one session link and skips a repeat', () => {
    expect(action.runs.steps[0]?.shell).toBe('bash')
    expect(action.runs.steps[0]?.env).toMatchObject({
      GH_TOKEN: '${{ github.token }}',
      TARGET: '${{ inputs.target }}',
      SESSION_ID: '${{ inputs.session-id }}',
      SESSION_URL: '${{ inputs.session-url }}',
    })
    expect(script).toContain('👀 [View the Auto Harness session](${SESSION_URL}).')
    expect(script).toContain('<!-- auto-harness-session:${SESSION_ID} -->')
    expect(script).toContain('gh issue comment "$TARGET"')
    expect(script).toContain('Session comment already exists')
    expect(script).toContain('^sess-[0-9a-f]{8}$')
    expect(script).not.toContain('${{')
  })

  it('contains no product identifiers', () => {
    expect(source).not.toMatch(/vouchington|voucha/iu)
  })
})
