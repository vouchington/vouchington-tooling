import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Step = {
  id?: string
  if?: string
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
  env?: Record<string, unknown>
}

type Action = {
  inputs?: Record<string, { default?: string }>
  outputs?: Record<string, { value?: string }>
  runs?: { steps?: Step[] }
}

const action = load(readFileSync('.github/actions/code-review-poster/action.yml', 'utf8')) as Action
const agent = load(readFileSync('.github/actions/code-review/action.yml', 'utf8')) as Action
const steps = action.runs?.steps ?? []
const stepByName = new Map(steps.map((step) => [step.name, step]))

describe('code-review-poster action', () => {
  it('downloads one same-run artifact and posts through the library CLI', () => {
    const download = stepByName.get('Download review payload')
    expect(download?.with).toEqual({
      'artifact-ids': '${{ inputs.artifact_id }}',
      path: '${{ runner.temp }}/code-review-payload-download',
      'github-token': '${{ github.token }}',
      repository: '${{ github.repository }}',
      'run-id': '${{ github.run_id }}',
    })
    expect(stepByName.get('Validate downloaded review payload')?.run).toContain(
      'gha-review-payload/cli.mts',
    )
    expect(stepByName.get('Post batched review')?.run).toContain('gha-post-review/cli.mts')
    expect(stepByName.get('Post batched review')?.env?.CODE_REVIEW_TOKEN_SOURCE).toBe(
      '${{ inputs.token_source }}',
    )
    expect(action.inputs?.token_source).toMatchObject({ default: 'claude-app' })
  })

  it('reuses the code-review Node resolver', () => {
    expect(stepByName.get('Resolve trusted Node version')?.run).toContain(
      '../code-review/resolve-node-version.sh',
    )
    const agentResolver = (agent.runs?.steps ?? []).find(
      (step) => step.name === 'Resolve trusted Node version',
    )
    expect(agentResolver?.run).toContain('resolve-node-version.sh')
  })
})
