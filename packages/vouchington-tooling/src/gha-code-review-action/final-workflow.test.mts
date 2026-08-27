import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Job = {
  'continue-on-error'?: boolean
  if?: string
  name?: string
  needs?: string[]
  permissions?: Record<string, string>
  'runs-on'?: string | string[]
  steps?: Array<{
    name?: string
    run?: string
    uses?: string
    with?: Record<string, string>
  }>
}

type Workflow = {
  concurrency?: { 'cancel-in-progress'?: boolean; group?: string }
  jobs?: Record<string, Job>
  on?: {
    pull_request_target?: { types?: string[] }
    workflow_run?: { types?: string[]; workflows?: string[] }
  }
}

const finalReviewText = readFileSync('.github/workflows/final-code-review.yml', 'utf8')
const finalReview = load(finalReviewText) as Workflow
const ci = load(readFileSync('.github/workflows/ci.yml', 'utf8')) as Workflow
const routerText = readFileSync('.github/workflows/ci-request-final-code-review.yml', 'utf8')
const router = load(routerText) as Workflow

describe('final code review workflow', () => {
  it('creates the native required gate from trusted default-branch code for every PR head', () => {
    expect(finalReview.on?.pull_request_target?.types).toEqual(['labeled', 'ready_for_review'])
    expect(finalReview.concurrency).toEqual({
      group:
        "final-code-review-${{ github.event.pull_request.number }}-${{ github.event.pull_request.head.sha }}-${{ github.event.action }}-${{ github.event.label.name || 'none' }}",
      'cancel-in-progress': false,
    })

    const gate = finalReview.jobs?.['code-reviewed']
    expect(gate?.name).toContain("&& 'Code Reviewed'")
    expect(gate?.name).toContain("|| 'Ignore final review request'")
    expect(gate?.if).toContain("github.event.label.name == 'final-code-review:requested'")
    expect(gate?.if).toContain('github.event.pull_request.draft == false')
    expect(gate?.permissions?.checks).toBeUndefined()
    expect(finalReviewText).not.toContain('repos/$GITHUB_REPOSITORY/check-runs')
  })

  it('requires the exact CI workflow, PR, head SHA, and successful tests job', () => {
    const selector = finalReview.jobs?.['select-final-review']
    const script = selector?.steps?.at(0)?.run ?? ''

    expect(selector?.permissions?.actions).toBe('read')
    expect(selector?.steps?.some((step) => step.uses?.includes('checkout'))).toBe(false)
    expect(script).toContain('actions/workflows/ci.yml/runs')
    expect(script).toContain('-f "head_sha=$head_sha"')
    expect(script).toContain('-f event=pull_request')
    expect(script).toContain('any(.pull_requests[]?; .number == $pr)')
    expect(script).toContain('.name == "tests" and .conclusion == "success"')
    expect(script.indexOf('tests_passed=true')).toBeLessThan(
      script.indexOf('gate_status untrusted'),
    )
  })

  it('passes forks and dependency bots only after tests without provider secrets or checkout', () => {
    const script = finalReview.jobs?.['select-final-review']?.steps?.at(0)?.run ?? ''

    expect(script).toContain('if [ "$is_cross_repository" = true ]')
    for (const login of [
      'dependabot',
      'dependabot[bot]',
      'app/dependabot',
      'renovate',
      'renovate[bot]',
      'app/renovate',
    ]) {
      expect(script).toContain(login)
    }
    expect(script).toContain('output gate_status untrusted')
    expect(finalReview.jobs?.['validate-review-settings']?.if).toContain(
      "gate_status != 'untrusted'",
    )
  })

  it('runs OpenRouter and Zen as parallel advisory lanes', () => {
    const providers = ['opencode-code-review', 'opencode-zen-code-review']
    for (const provider of providers) {
      expect(finalReview.jobs?.[provider]?.needs).toEqual([
        'select-final-review',
        'validate-review-settings',
      ])
      expect(finalReview.jobs?.[provider]?.['continue-on-error']).toBe(true)
    }
    expect(finalReview.jobs?.['opencode-code-review-poster']?.['continue-on-error']).toBe(true)
    expect(finalReview.jobs?.['opencode-zen-code-review-poster']?.['continue-on-error']).toBe(true)

    const gateScript = finalReview.jobs?.['code-reviewed']?.steps?.at(0)?.run ?? ''
    expect(gateScript).toContain('Review selection failed')
    expect(gateScript).toContain('Review settings are invalid')
    expect(gateScript).toContain('review did not complete successfully')
    expect(gateScript).not.toContain('A required code review provider failed')
  })

  it('uses GitHub-hosted runners throughout this public repository workflow', () => {
    for (const job of Object.values(finalReview.jobs ?? {})) {
      expect(job['runs-on']).toBe('ubuntu-latest')
    }
  })

  it.each([
    ['opencode-code-review', 'OPENROUTER_FREE_API_KEY', 'OPENCODE_CODE_REVIEW_MODEL'],
    ['opencode-zen-code-review', 'OPENCODE_FREE_API_KEY', 'OPENCODE_ZEN_CODE_REVIEW_MODEL'],
  ])('isolates %s from write permissions and PR-controlled actions', (jobName, secret, model) => {
    const job = finalReview.jobs?.[jobName]
    expect(job?.permissions?.['pull-requests']).toBe('read')
    expect(job?.permissions?.issues).toBe('read')
    const reviewStep = job?.steps?.find((step) => step.uses?.includes('opencode-code-review'))
    expect(reviewStep?.uses).toBe('./.trusted-review-action/.github/actions/opencode-code-review')
    expect(reviewStep?.with?.model).toBe(`\${{ vars.${model} }}`)
    expect(Object.values(reviewStep?.with ?? {})).toContain(`\${{ secrets.${secret} }}`)
  })

  it('routes a successful exact ready-head CI fan-in into the native gate', () => {
    expect(ci.jobs).not.toHaveProperty('untrusted-code-reviewed')
    expect(ci.jobs).not.toHaveProperty('request-final-code-review')
    expect(finalReviewText).not.toContain('workflow_dispatch')
    expect(router.on?.workflow_run).toEqual({ workflows: ['CI'], types: ['completed'] })
    expect(routerText).toContain('github.event.workflow_run.head_sha')
    expect(routerText).toContain('GH_TOKEN: ${{ github.token }}')
    expect(routerText).toContain('TRIGGER_TOKEN: ${{ secrets.CODE_REVIEW_TRIGGER_TOKEN }}')
    const labelDeletes = routerText
      .split('\n')
      .filter((line) => line.includes('gh_retry 404 gh api --method DELETE'))
    expect(labelDeletes).toHaveLength(3)
    expect(labelDeletes.every((line) => line.includes('GH_TOKEN="$TRIGGER_TOKEN"'))).toBe(true)
    expect(routerText).toContain('GH_TOKEN="$TRIGGER_TOKEN" gh_retry none gh api --method POST')
    expect(router.jobs?.['request-final-code-review']?.permissions).toEqual({
      actions: 'read',
      checks: 'read',
      contents: 'read',
      'pull-requests': 'read',
    })
    expect(routerText).not.toContain('GH_TOKEN: ${{ secrets.CODE_REVIEW_TRIGGER_TOKEN }}')
    expect(routerText).toContain('commits/$TESTED_HEAD_SHA/pulls')
    expect(routerText).toContain('.head.repo.full_name == $head_repo')
    expect(routerText).toContain('.path == ".github/workflows/final-code-review.yml"')
    expect(routerText).toContain('cancel-in-progress: false')
    expect(routerText).toContain('.base.ref == $base')
    expect(routerText).toContain('.name == "tests"')
    expect(routerText).toContain('sort_by(.run_attempt, .id)')
    expect(routerText).toContain('[ "$is_draft" = true ]')
    expect(routerText).toContain('final_state')
    expect(routerText).toContain('-f "labels[]=$REQUESTED_LABEL"')
  })
})

describe('CI final review fan-in', () => {
  it('cancels stale CI runs but exposes the stable tests gate', () => {
    expect(ci.concurrency?.['cancel-in-progress']).toBe(true)
    expect(ci.jobs?.tests?.name).toBe('tests')
    expect(ci.jobs?.tests?.needs).toEqual(['test', 'actionlint'])
  })
})
