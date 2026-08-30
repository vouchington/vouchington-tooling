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
const neutral = load(readFileSync('.github/actions/review-poster/action.yml', 'utf8')) as Action
const claude = load(
  readFileSync('.github/actions/claude-code-review-poster/action.yml', 'utf8'),
) as Action
const steps = action.runs?.steps ?? []
const stepByName = new Map(steps.map((step) => [step.name, step]))

describe('code-review-poster action', () => {
  it('downloads one same-run artifact and posts through the library CLI', () => {
    const download = stepByName.get('Download review payload')
    expect(download?.with).toEqual({
      'artifact-ids': '${{ inputs.artifact_id }}',
      path: '${{ runner.temp }}/code-review-payload-download',
      'github-token': '${{ inputs.github_token || github.token }}',
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
    expect(stepByName.get('Post batched review')?.env).toMatchObject({
      EXPECTED_HEAD_SHA: '${{ inputs.expected_head_sha }}',
      EXPECTED_BASE_SHA: '${{ inputs.expected_base_sha }}',
    })
    expect(action.inputs?.expected_head_sha).toMatchObject({ default: '' })
    expect(action.inputs?.expected_base_sha).toMatchObject({ default: '' })
    expect(action.inputs?.token_source).toMatchObject({ default: 'claude-app' })
    expect(action.inputs?.compatibility_warning).toMatchObject({ default: 'true' })
  })

  it('provides explicit neutral and Claude poster entrypoints', () => {
    const neutralSteps = neutral.runs?.steps ?? []
    const validation = neutralSteps.find((step) => step.name === 'Validate explicit poster inputs')
    const neutralPoster = neutralSteps.find((step) => step.id === 'poster')
    expect(validation?.run).toContain('post_token is required')
    expect(neutralPoster?.uses).toBe('$/.github/actions/code-review-poster')
    expect(neutralPoster?.with).toMatchObject({
      compatibility_warning: 'false',
      token_source: 'github-token',
      github_token: '${{ inputs.post_token }}',
    })
    const claudePoster = claude.runs?.steps?.find((step) => step.id === 'poster')
    expect(claudePoster?.uses).toBe('$/.github/actions/code-review-poster')
    expect(claudePoster?.with).toMatchObject({
      compatibility_warning: 'false',
      token_source: 'claude-app',
    })
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
