import { existsSync, readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Step = {
  env?: Record<string, string>
  id?: string
  if?: string
  name?: string
  run?: string
  uses?: string
  with?: Record<string, string>
}

type Job = {
  'continue-on-error'?: boolean
  if?: string
  name?: string
  needs?: string[]
  permissions?: Record<string, string>
  'runs-on'?: string | string[]
  steps?: Step[]
}

type Workflow = {
  concurrency?: { 'cancel-in-progress'?: boolean; group?: string }
  jobs?: Record<string, Job>
  on?: {
    pull_request_target?: { types?: string[] }
    workflow_run?: unknown
  }
}

const finalReviewText = readFileSync('.github/workflows/final-code-review.yml', 'utf8')
const finalReview = load(finalReviewText) as Workflow
const ci = load(readFileSync('.github/workflows/ci.yml', 'utf8')) as Workflow
const selectAction = readFileSync('.github/actions/final-review-select/action.yml', 'utf8')
const gateAction = readFileSync('.github/actions/final-review-gate/action.yml', 'utf8')
const selectScript = readFileSync('.github/actions/final-review-select/select.sh', 'utf8')
const waitScript = readFileSync('.github/actions/final-review-select/wait-for-tests.sh', 'utf8')
const dispatchScript = readFileSync(
  '.github/actions/final-review-dispatch-claude/dispatch-claude.sh',
  'utf8',
)
const gateScript = readFileSync('.github/actions/final-review-gate/gate.sh', 'utf8')

describe('final code review workflow', () => {
  it('creates the native required gate from trusted default-branch code for every PR head', () => {
    expect(finalReview.on?.pull_request_target?.types).toEqual([
      'opened',
      'reopened',
      'synchronize',
      'ready_for_review',
      'converted_to_draft',
      'closed',
    ])
    expect(finalReview.concurrency).toEqual({
      group:
        'final-code-review-${{ github.event.pull_request.number }}-${{ github.event.pull_request.head.sha }}',
      'cancel-in-progress': true,
    })

    const gate = finalReview.jobs?.['code-reviewed']
    expect(gate?.name).toContain("&& 'Code Reviewed'")
    expect(gate?.name).toContain("|| 'Ignore ineligible final review'")
    expect(gate?.if).toContain('always()')
    expect(gate?.permissions).toEqual({
      issues: 'write',
      'pull-requests': 'write',
    })
    expect(finalReviewText).not.toContain('repos/$GITHUB_REPOSITORY/check-runs')
    expect(existsSync('.github/workflows/ci-request-final-code-review.yml')).toBe(false)
  })

  it('grants issues and pull-requests write so completion labels do not 403', () => {
    expect(finalReview.jobs?.['select-final-review']?.permissions).toMatchObject({
      issues: 'write',
      'pull-requests': 'write',
    })
    expect(finalReview.jobs?.['code-reviewed']?.permissions).toMatchObject({
      issues: 'write',
      'pull-requests': 'write',
    })
    expect(selectAction).toContain('issues: write and pull-requests: write')
    expect(gateAction).toContain('issues: write and pull-requests: write')
    expect(selectAction).toContain('33269571876')
    expect(gateAction).toContain('33269571876')
  })

  it('selects only a trusted, tested exact head through the extracted composite', () => {
    const selector = finalReview.jobs?.['select-final-review']
    const selectStep = selector?.steps?.find((step) => step.id === 'select')

    expect(selector?.permissions?.actions).toBe('read')
    expect(selector?.steps?.some((step) => step.uses?.includes('actions/checkout'))).toBe(true)
    expect(selectStep?.uses).toBe('./.github/actions/final-review-select')
    expect(waitScript).toContain('actions/workflows/$ci_workflow/runs')
    expect(waitScript).toContain('-f "head_sha=$head_sha"')
    expect(waitScript).toContain('-f event=pull_request')
    expect(waitScript).toContain('any(.pull_requests[]?; .number == $pr)')
    expect(waitScript).toContain('$tests')
    expect(waitScript).toContain('FORBIDDEN_SUCCESS_JOB')
    expect(selectScript).not.toContain('ci-expensive-deferred')
    expect(waitScript).not.toContain('ci-expensive-deferred')
    expect(selectScript).toContain('export head_sha head_repository head_ref base_sha')
    expect(selectScript.indexOf('is_untrusted=true')).toBeLessThan(
      selectScript.indexOf('gate_status untrusted'),
    )
  })

  it('passes forks and dependency bots only after tests without provider secrets', () => {
    expect(selectScript).toContain('if [ "$is_cross_repository" = true ]')
    for (const login of [
      'dependabot',
      'dependabot[bot]',
      'app/dependabot',
      'renovate',
      'renovate[bot]',
      'app/renovate',
    ]) {
      expect(selectScript).toContain(login)
    }
    expect(selectScript).toContain('output gate_status untrusted')
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
    for (const posterName of ['opencode-code-review-poster', 'opencode-zen-code-review-poster']) {
      const poster = finalReview.jobs?.[posterName]?.steps?.find((step) =>
        step.uses?.includes('code-review-poster'),
      )
      expect(poster?.with).toMatchObject({
        expected_head_sha: '${{ needs.select-final-review.outputs.head_sha }}',
        expected_base_sha: '${{ needs.select-final-review.outputs.base_sha }}',
      })
    }

    expect(gateScript).toContain('Review selection failed')
    expect(gateScript).toContain('gh_capture_retry none gh api --method GET')
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

  it('dispatches Claude with string required_review and keeps it advisory', () => {
    const dispatch = finalReview.jobs?.['claude-code-review']
    expect(dispatch?.['continue-on-error']).toBe(true)
    expect(dispatch?.steps?.find((step) => step.id === 'dispatch')?.uses).toBe(
      './.github/actions/final-review-dispatch-claude',
    )
    expect(dispatchScript).toContain('required_review: "true"')
    expect(dispatchScript).not.toContain('--argjson')
    expect(JSON.stringify(dispatch)).not.toContain('CLAUDE_CODE_OAUTH_TOKEN')
  })

  it('routes a successful exact ready-head CI fan-in into the native gate', () => {
    expect(ci.jobs).not.toHaveProperty('untrusted-code-reviewed')
    expect(ci.jobs).not.toHaveProperty('request-final-code-review')
    expect(finalReview.on?.workflow_run).toBeUndefined()
  })
})

describe('CI final review fan-in', () => {
  it('cancels stale CI runs but exposes the stable tests gate', () => {
    expect(ci.concurrency?.['cancel-in-progress']).toBe(true)
    expect(ci.jobs?.tests?.name).toBe('tests')
    expect(ci.jobs?.tests?.needs).toEqual(['test', 'actionlint'])
  })
})
