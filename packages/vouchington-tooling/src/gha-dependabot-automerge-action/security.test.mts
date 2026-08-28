import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  env?: Record<string, string>
  id?: string
  uses?: string
  with?: Record<string, string>
}

type Action = {
  inputs: Record<string, { default?: string; required?: boolean }>
  runs: { steps: Step[] }
}

const source = readFileSync('.github/actions/dependabot-automerge/action.yml', 'utf8')
const action = load(source) as Action
const metadata = action.runs.steps.find((step) => step.id === 'dependabot-metadata')
const script = action.runs.steps.find((step) => step.uses?.startsWith('actions/github-script@'))

describe('Dependabot auto-merge action security boundary', () => {
  it('uses read credentials for metadata and isolates the mutation token', () => {
    expect(metadata?.uses).toMatch(/^dependabot\/fetch-metadata@[a-f0-9]{40}$/)
    expect(metadata?.with?.['github-token']).toBe('${{ github.token }}')
    expect(script?.uses).toMatch(/^actions\/github-script@[a-f0-9]{40}$/)
    expect(script?.with?.['github-token']).toBe('${{ github.token }}')
    expect(script?.env?.AUTOMERGE_TOKEN).toBe('${{ inputs.automerge_token }}')
    expect(script?.env?.EXPECTED_BASE_SHA).toContain('github.event.pull_request.base.sha')
    expect(script?.env?.EXPECTED_HEAD_SHA).toContain('github.event.pull_request.head.sha')
    expect(script?.env?.GRAPHQL_URL).toBe('${{ github.graphql_url }}')
    expect(action.inputs.automerge_token?.required).toBe(true)
    expect(action.inputs.manual_update_rules?.default).toBe('[]')
    expect(source).toContain('fetch(process.env.GRAPHQL_URL')
    expect(source).not.toContain('https://api.github.com/graphql')
    expect(source).toContain('mergeMethod: SQUASH')
    expect(source).not.toMatch(/listReviews|createReview|APPROVE|actions\/checkout/)
  })

  it('revalidates the live Dependabot branch before the final mutation', () => {
    expect(source).toContain("freshPr.user?.login !== 'dependabot[bot]'")
    expect(source).toContain('freshPr.base?.ref !== context.payload.repository.default_branch')
    expect(source).toContain('freshPr.base?.sha !== expectedBase')
    expect(source).toContain('freshPr.head?.sha !== expectedHead')
    expect(source).toContain("freshPr.state !== 'open'")
    expect(source).toContain('freshPr.draft')
    expect(source).toContain('freshPr.merged')
    expect(source).toContain('freshPr.head?.repo?.full_name')
    expect(source).toContain("freshPr.head?.ref?.startsWith('dependabot/')")
    expect(source).toContain('Expected base and head SHAs must be 40-character')
    expect(source).toContain('disablePullRequestAutoMerge')
    expect(source).toContain('expectedHeadOid: expectedHead')
    expect(source.indexOf('github.rest.pulls.get')).toBeLessThan(
      source.indexOf('expectedHeadOid: expectedHead'),
    )
  })
})
