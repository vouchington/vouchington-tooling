import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Step = {
  name?: string
  id?: string
  if?: string
  shell?: string
  env?: Record<string, string>
  run?: string
  uses?: string
  with?: Record<string, unknown>
  'continue-on-error'?: boolean
}

type Job = {
  name?: string
  'runs-on'?: unknown
  'timeout-minutes'?: number
  needs?: string[]
  if?: string
  permissions?: Record<string, string>
  concurrency?: { group?: string; queue?: string; 'cancel-in-progress'?: boolean }
  outputs?: Record<string, string>
  steps?: Step[]
}

type Workflow = {
  name?: string
  on?: {
    workflow_call?: {
      inputs?: Record<string, { required?: boolean; type?: string; default?: string }>
      outputs?: Record<string, unknown>
      secrets?: Record<string, { required?: boolean }>
    }
    workflow_dispatch?: unknown
  }
  permissions?: Record<string, unknown>
  jobs?: Record<string, Job>
}

const path = '.github/workflows/opencode-code-review.yml'
const text = readFileSync(path, 'utf8')
const workflow = load(text) as Workflow

describe('opencode-code-review reusable workflow', () => {
  it('is workflow_call only, with no dispatch surface or free-text prompt input', () => {
    expect(workflow.on?.workflow_dispatch).toBeUndefined()
    expect(text).not.toContain('@claude')
    expect(workflow.on?.workflow_call?.inputs).not.toHaveProperty('prompt')
    expect(workflow.on?.workflow_call?.inputs).not.toHaveProperty('extra_prompt')
    expect(Object.keys(workflow.on?.workflow_call?.inputs ?? {}).sort()).toEqual(
      ['model', 'provider', 'pr_number', 'runs_on', 'timeout_minutes', 'tooling_ref'].sort(),
    )
    expect(workflow.on?.workflow_call?.inputs).toMatchObject({
      provider: { required: true, type: 'string' },
      model: { required: true, type: 'string' },
      pr_number: { required: true, type: 'string' },
      tooling_ref: { required: true, type: 'string' },
      runs_on: { required: false, type: 'string', default: '["ubuntu-latest"]' },
      timeout_minutes: { required: false, type: 'string', default: '60' },
    })
    expect(workflow.on?.workflow_call?.secrets).toEqual({
      code_review_api_key: { description: expect.any(String), required: false },
    })
    expect(workflow.permissions).toEqual({})
  })

  it('defines exactly two unnamed jobs, review then post', () => {
    expect(Object.keys(workflow.jobs ?? {})).toEqual(['review', 'post'])
    expect(workflow.jobs?.review?.name).toBeUndefined()
    expect(workflow.jobs?.post?.name).toBeUndefined()
    expect(text).not.toMatch(/^ {2}review:\n {4}name:/m)
    expect(text).not.toMatch(/^ {2}post:\n {4}name:/m)
  })

  it('never lets the review job block on a stalled agent or a caller-side outage', () => {
    const review = workflow.jobs?.review
    expect(review?.['timeout-minutes']).toBe(75)
    expect(review?.concurrency).toEqual({
      group: 'opencode-code-review-${{ inputs.provider }}',
      queue: 'max',
      'cancel-in-progress': false,
    })
    expect(review?.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' })
    expect(review?.outputs).toEqual({
      agent_outcome: '${{ steps.agent.outputs.agent_outcome }}',
      payload_artifact_id: '${{ steps.agent.outputs.payload_artifact_id }}',
    })
    const steps = review?.steps ?? []
    expect(steps[0]?.name).toBe('Validate immutable tooling ref')
    for (const name of ["Checkout calling repo's PR ref", 'Checkout review actions']) {
      expect(steps.find((step) => step.name === name)?.['continue-on-error']).toBe(true)
    }
    const agentStep = steps.find((step) => step.name === 'Run OpenCode Code Review')
    expect(agentStep?.['continue-on-error']).toBe(true)
    expect(agentStep?.uses).toBe('./.vouchington-tooling/.github/actions/opencode-code-review')
  })

  it('validates tooling_ref as a full lowercase SHA before any arithmetic or checkout, in both jobs', () => {
    for (const jobId of ['review', 'post'] as const) {
      const job = workflow.jobs?.[jobId]
      const guard = job?.steps?.[0]
      expect(guard?.name).toBe('Validate immutable tooling ref')
      expect(guard?.shell).toBe('bash')
      expect(guard?.env?.TOOLING_REF).toBe('${{ inputs.tooling_ref }}')
      expect(guard?.run).toContain('^[0-9a-f]{40}$')
      expect(guard?.run).toContain('tooling_ref must be a full lowercase commit SHA')
    }
    expect(text.match(/repository: vouchington\/vouchington-tooling/g)).toHaveLength(2)
    expect(text.match(/ref: \$\{\{ inputs\.tooling_ref \}\}/g)).toHaveLength(2)
  })

  it('clamps timeout_minutes to a 1-3600 second range without ever failing the job', () => {
    const timeoutStep = workflow.jobs?.review?.steps?.find(
      (step) => step.name === 'Compute review timeout',
    )
    expect(timeoutStep?.env?.TIMEOUT_MINUTES).toBe('${{ inputs.timeout_minutes }}')
    expect(timeoutStep?.run).toContain('case "$TIMEOUT_MINUTES" in')
    expect(timeoutStep?.run).toContain("''|*[!0-9]*)")
    expect(timeoutStep?.run).toContain('timeout_seconds=$((TIMEOUT_MINUTES * 60))')
    expect(timeoutStep?.run).toContain('-gt 3600')
    expect(timeoutStep?.run).not.toContain('exit 1')
    const agentStep = workflow.jobs?.review?.steps?.find(
      (step) => step.name === 'Run OpenCode Code Review',
    )
    expect(agentStep?.with?.timeout_seconds).toBe('${{ steps.timeout.outputs.seconds }}')
  })

  it('resolves the trusted base ref itself since the input surface has no expected_base_sha', () => {
    const refsStep = workflow.jobs?.review?.steps?.find(
      (step) => step.name === 'Resolve pull request refs',
    )
    expect(refsStep?.env?.GH_TOKEN).toBe('${{ github.token }}')
    expect(refsStep?.run).toContain('pulls/$PR_NUMBER')
    expect(refsStep?.run).toContain("--jq '[.head.sha, .base.sha] | @tsv'")
    expect(refsStep?.run).toContain('|| true')
    expect(refsStep?.run).toContain('^[0-9a-f]{40}$')
    expect(refsStep?.run).not.toContain('exit 1')
    const agentStep = workflow.jobs?.review?.steps?.find(
      (step) => step.name === 'Run OpenCode Code Review',
    )
    expect(agentStep?.with?.trusted_prompt_ref).toBe('${{ steps.pr-refs.outputs.base_sha }}')
    const headCheckout = workflow.jobs?.review?.steps?.find(
      (step) => step.name === "Checkout calling repo's PR ref",
    )
    expect(headCheckout?.with?.ref).toBe('${{ steps.pr-refs.outputs.head_sha || github.sha }}')
  })

  it('maps the single secret to whichever provider input the caller selected', () => {
    const agentStep = workflow.jobs?.review?.steps?.find(
      (step) => step.name === 'Run OpenCode Code Review',
    )
    expect(agentStep?.with?.openrouter_api_key).toBe(
      "${{ inputs.provider == 'openrouter' && secrets.code_review_api_key || '' }}",
    )
    expect(agentStep?.with?.opencode_api_key).toBe(
      "${{ inputs.provider == 'opencode-zen' && secrets.code_review_api_key || '' }}",
    )
    expect(agentStep?.with?.payload_artifact_name).toBe(
      '${{ inputs.pr_number }}-${{ inputs.provider }}',
    )
  })

  it('only posts when the review job actually produced a payload, and never blocks on the poster', () => {
    const post = workflow.jobs?.post
    expect(post?.needs).toEqual(['review'])
    expect(post?.if).toBe("always() && needs.review.outputs.payload_artifact_id != ''")
    expect(post?.['timeout-minutes']).toBe(5)
    expect(post?.permissions).toEqual({
      actions: 'read',
      contents: 'read',
      'pull-requests': 'write',
    })
    const posterStep = post?.steps?.find((step) => step.name === 'Post Code Review')
    expect(posterStep?.['continue-on-error']).toBe(true)
    expect(posterStep?.uses).toBe('./.vouchington-tooling/.github/actions/code-review-poster')
    expect(posterStep?.with).toMatchObject({
      pr_number: '${{ inputs.pr_number }}',
      artifact_id: '${{ needs.review.outputs.payload_artifact_id }}',
      provider_name: '${{ inputs.provider }}',
      token_source: 'github-token',
    })
    const checkoutStep = post?.steps?.find((step) => step.name === 'Checkout review actions')
    expect(checkoutStep?.['continue-on-error']).toBe(true)
  })
})
