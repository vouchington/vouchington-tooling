import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Workflow = {
  on?: {
    workflow_call?: { inputs?: Record<string, unknown>; secrets?: Record<string, unknown> }
    workflow_dispatch?: { inputs?: Record<string, unknown> }
    issue_comment?: unknown
  }
  jobs?: Record<
    string,
    {
      steps?: Array<{
        env?: Record<string, unknown>
        if?: string
        name?: string
        run?: string
        uses?: string
        with?: Record<string, unknown>
      }>
      permissions?: Record<string, unknown>
    }
  >
}

const workflow = load(readFileSync('.github/workflows/code-review.yml', 'utf8')) as Workflow
const text = readFileSync('.github/workflows/code-review.yml', 'utf8')

describe('code-review reusable workflow', () => {
  it('does not expose a free-text prompt on public dispatch', () => {
    expect(workflow.on?.issue_comment).toBeUndefined()
    expect(text).not.toContain('@claude')
    const dispatchInputs = Object.keys(workflow.on?.workflow_dispatch?.inputs ?? {})
    expect(dispatchInputs).toEqual([
      'pr_number',
      'expected_head_sha',
      'expected_base_sha',
      'trusted_prompt_ref',
      'model',
      'effort',
      'required_review',
    ])
    expect(workflow.on?.workflow_call?.inputs).not.toHaveProperty('prompt')
    expect(workflow.on?.workflow_dispatch?.inputs).not.toHaveProperty('prompt')
    expect(workflow.on?.workflow_dispatch?.inputs).not.toHaveProperty('extra_prompt')
  })

  it('runs an uncredentialed agent job and a separate poster job', () => {
    expect(Object.keys(workflow.jobs ?? {})).toEqual(['review', 'poster'])
    expect(workflow.jobs?.review?.permissions).toEqual({
      actions: 'read',
      contents: 'read',
      'pull-requests': 'read',
    })
    expect(workflow.jobs?.poster?.permissions).toEqual({
      actions: 'read',
      contents: 'read',
      'pull-requests': 'write',
      'id-token': 'write',
    })
    const reviewUses = workflow.jobs?.review?.steps?.map((step) => step.uses)
    expect(reviewUses?.some((uses) => uses?.includes('code-review'))).toBe(true)
    expect(reviewUses?.some((uses) => uses?.includes('code-review-poster'))).toBe(false)
    expect(
      workflow.jobs?.poster?.steps?.some((step) => step.uses?.includes('code-review-poster')),
    ).toBe(true)
  })

  it('rejects stale selected refs before reviewing or posting', () => {
    expect(workflow.on?.workflow_call?.inputs).toMatchObject({
      expected_head_sha: expect.any(Object),
      expected_base_sha: expect.any(Object),
    })
    expect(workflow.on?.workflow_dispatch?.inputs).toMatchObject({
      expected_head_sha: expect.any(Object),
      expected_base_sha: expect.any(Object),
      trusted_prompt_ref: expect.any(Object),
    })

    const reviewSteps = workflow.jobs?.review?.steps ?? []
    const posterSteps = workflow.jobs?.poster?.steps ?? []
    const reviewGuard = reviewSteps.find(
      (step) => step.name === 'Validate selected pull request refs',
    )
    const poster = posterSteps.find((step) => step.uses?.includes('code-review-poster') === true)
    expect(reviewGuard?.run).toContain('EXPECTED_HEAD_SHA')
    expect(reviewGuard?.run).toContain('EXPECTED_BASE_SHA')
    expect(reviewGuard?.run).toContain('TRUSTED_PROMPT_REF')
    expect(reviewGuard?.run).toContain('set -euo pipefail')
    expect(reviewGuard?.run).toContain('^[0-9a-f]{40}$')
    expect(reviewGuard?.run).toContain('must be provided together')
    expect(reviewGuard?.run).toContain('Could not resolve PR head SHA')
    expect(reviewGuard?.run).toContain('Could not resolve PR base SHA')
    expect(reviewGuard?.run).toContain('pulls/$PR_NUMBER')
    expect(reviewGuard?.if).toBe("inputs.expected_head_sha != '' || inputs.expected_base_sha != ''")
    expect(reviewGuard?.run).toContain("--jq '[.head.sha, .base.sha] | @tsv'")
    expect(reviewGuard?.run).not.toContain('jq -r')
    const repositoryCheckout = reviewSteps.find((step) => step.name === 'Checkout repository')
    expect(repositoryCheckout?.with?.ref).toBe('${{ inputs.expected_head_sha || github.sha }}')
    expect(poster?.with).toMatchObject({
      expected_head_sha: '${{ inputs.expected_head_sha }}',
      expected_base_sha: '${{ inputs.expected_base_sha }}',
    })
    expect(reviewSteps.indexOf(reviewGuard!)).toBeLessThan(
      reviewSteps.findIndex((step) => step.uses?.includes('code-review') === true),
    )
  })

  it('loads nested composites from the workflow SHA, not the caller SHA', () => {
    expect(text).toContain('ref: ${{ github.workflow_sha }}')
    expect(text).toContain('repository: vouchington/vouchington-tooling')
  })
})
