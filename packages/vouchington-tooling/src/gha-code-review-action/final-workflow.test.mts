import { existsSync, readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Step = {
  env?: Record<string, string>
  id?: string
  uses?: string
  with?: Record<string, string>
}
type Job = {
  'continue-on-error'?: boolean
  if?: string
  name?: string
  permissions?: Record<string, string>
  'runs-on'?: string | string[]
  steps?: Step[]
  'timeout-minutes'?: number
  uses?: string
  with?: Record<string, string>
}
type Workflow = {
  concurrency?: { 'cancel-in-progress'?: boolean; group?: string }
  jobs?: Record<string, Job>
  on?: {
    pull_request_target?: { types?: string[] }
    repository_dispatch?: { types?: string[] }
    workflow_run?: { types?: string[]; workflows?: string[] }
  }
}

const finalText = readFileSync('.github/workflows/final-code-review.yml', 'utf8')
const finalReview = load(finalText) as Workflow
const requestText = readFileSync('.github/workflows/request-final-review.yml', 'utf8')
const request = load(requestText) as Workflow
const cleanupText = readFileSync('.github/workflows/clear-final-review-labels.yml', 'utf8')
const cleanup = load(cleanupText) as Workflow
const labelerText = readFileSync('.github/workflows/labeler.yml', 'utf8')
const reusableReview = load(readFileSync('.github/workflows/code-review.yml', 'utf8')) as Workflow
const ciText = readFileSync('.github/workflows/ci.yml', 'utf8')
const ci = load(ciText) as Workflow
const gateAction = readFileSync('.github/actions/final-review-gate/action.yml', 'utf8')
const gateScript = readFileSync('.github/actions/final-review-gate/gate.sh', 'utf8')

function expectPinnedExternalAction(text: string, action: string, requireVersionComment = false) {
  const escapedAction = action.replaceAll('.', '\\.')
  const comment = requireVersionComment ? '\\s+#\\s+v[0-9][^\\s]*' : ''
  expect(text).toMatch(
    new RegExp(`^\\s*(?:-\\s+)?uses: ${escapedAction}@[0-9a-f]{40}${comment}\\s*$`, 'm'),
  )
}

describe('event-driven final code review', () => {
  it('routes one completed CI event into one correlated review dispatch', () => {
    expect(request.on?.workflow_run).toEqual({ workflows: ['CI'], types: ['completed'] })
    expect(request.concurrency).toEqual({
      group:
        'request-final-review-${{ github.event.workflow_run.pull_requests[0].number || github.event.workflow_run.head_sha }}',
      'cancel-in-progress': false,
    })
    const router = request.jobs?.request
    expect(router?.if).toContain("workflow_run.event == 'pull_request'")
    expect(router?.permissions).toMatchObject({
      actions: 'read',
      checks: 'read',
      contents: 'write',
      issues: 'write',
      'pull-requests': 'write',
    })
    expectPinnedExternalAction(
      requestText,
      'vouchington/vouchington-tooling/.github/actions/request-final-review',
    )
    expect(router?.steps?.[0]?.with).toMatchObject({
      'source-workflow-path': '.github/workflows/ci.yml',
      'source-run-attempt': '${{ github.event.workflow_run.run_attempt }}',
      'fan-in-job': 'tests',
      'review-check-name': 'Code Reviewed',
    })
  })

  it('selects only the exact dispatched run without waiting for CI', () => {
    expect(finalReview.on?.repository_dispatch?.types).toEqual(['final-review-requested'])
    expect(finalReview.concurrency).toEqual({
      group:
        'final-code-review-${{ github.event.client_payload.pr_number }}-${{ github.event.client_payload.head_sha }}',
      'cancel-in-progress': true,
    })
    const selector = finalReview.jobs?.['select-final-review']
    const step = selector?.steps?.find(({ id }) => id === 'select')
    expectPinnedExternalAction(
      finalText,
      'vouchington/vouchington-tooling/.github/actions/select-final-review',
    )
    expect(step?.with).toMatchObject({
      'source-run-id': '${{ github.event.client_payload.source_run_id }}',
      'source-run-attempt': '${{ github.event.client_payload.source_run_attempt }}',
      'source-base-sha': '${{ github.event.client_payload.base_sha }}',
      'workflow-path': '.github/workflows/ci.yml',
      'fan-in-job': 'tests',
    })
    expect(finalText).not.toMatch(/WAIT_(ATTEMPTS|SECONDS)|TESTS_WAIT/)
    expect(existsSync('.github/actions/final-review-select/action.yml')).toBe(false)
  })

  it('calls Claude as a reusable dependency instead of dispatching and polling', () => {
    const claude = finalReview.jobs?.['claude-code-review']
    expect(claude?.uses).toBe('./.github/workflows/code-review.yml')
    expect(claude?.with).toMatchObject({
      required_review: "${{ 'false' }}",
      trusted_prompt_ref: '${{ needs.select-final-review.outputs.base_sha }}',
    })
    expect(claude?.with?.tooling_ref).toMatch(/^[0-9a-f]{40}$/)
    expect(existsSync('.github/actions/final-review-dispatch-claude/action.yml')).toBe(false)
    expect(finalText).toContain("needs.claude-code-review.outputs.agent_outcome == 'success'")
    expect(finalText).toContain('needs.claude-code-review.outputs.payload_artifact_id')
    expect(finalText).toContain("needs.claude-code-review.outputs.poster_outcome == 'success'")
  })

  it('publishes the required check on the selected pull-request head', () => {
    const gate = finalReview.jobs?.['code-reviewed']
    expect(gate?.name).toBe('Code Reviewed')
    expect(gate?.if).toContain('always()')
    expect(gate?.permissions).toMatchObject({
      checks: 'write',
      contents: 'read',
      issues: 'write',
      'pull-requests': 'write',
    })
    const gateStep = gate?.steps?.find(({ uses }) => uses === './.github/actions/final-review-gate')
    expect(gateStep?.with).toMatchObject({
      token: '${{ github.token }}',
      pr_number: '${{ needs.select-final-review.outputs.pr_number }}',
      selected_head_sha: '${{ needs.select-final-review.outputs.head_sha }}',
      selected_base_sha: '${{ needs.select-final-review.outputs.base_sha }}',
      complete_label: 'final-code-review:complete',
      requested_label: 'final-code-review:requested',
      check_name: 'Code Reviewed',
    })
    expect(gateAction).toContain('Publish selected-head check')
  })

  it('keeps provider failures advisory and covers draft lifecycle changes', () => {
    expect(gateScript).toContain('review did not complete successfully')
    expect(gateScript).not.toContain('A required code review provider failed')
    expect(ci.jobs?.tests?.name).toBe('tests')
    expect(ciText).toContain('ready_for_review')
    expect(ciText).toContain('converted_to_draft')
  })

  it('cancels review work and clears labels on trusted draft or close events', () => {
    expect(cleanup.on?.pull_request_target?.types).toEqual(['converted_to_draft', 'closed'])
    expect(cleanup.concurrency).toEqual({
      group:
        'final-code-review-${{ github.event.pull_request.number }}-${{ github.event.pull_request.head.sha }}',
      'cancel-in-progress': true,
    })
    expect(cleanup.jobs?.clear?.permissions).toEqual({
      issues: 'write',
      'pull-requests': 'write',
    })
    expect(cleanupText).toContain('final-code-review:requested')
    expect(cleanupText).toContain('final-code-review:complete')
    expect(cleanupText).not.toContain('actions/checkout')
    expect(cleanupText).not.toMatch(/sleep|poll|WAIT_/i)
  })

  it('keeps every concrete review job bounded and pins external action dependencies', () => {
    for (const workflow of [finalReview, request, cleanup, reusableReview]) {
      for (const job of Object.values(workflow.jobs ?? {})) {
        if (job['runs-on'] === undefined) continue
        expect(job['timeout-minutes']).toEqual(expect.any(Number))
        expect(job['timeout-minutes']).toBeLessThanOrEqual(30)
      }
    }

    expectPinnedExternalAction(labelerText, 'actions/labeler', true)
  })
})
