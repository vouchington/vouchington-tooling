import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Job = {
  'continue-on-error'?: boolean
  if?: string
  name?: string
  needs?: string[]
  permissions?: Record<string, string>
  steps?: Array<{
    env?: Record<string, string>
    if?: string
    name?: string
    run?: string
    uses?: string
    with?: Record<string, string>
  }>
}

type Workflow = {
  concurrency?: { 'cancel-in-progress'?: boolean }
  jobs?: Record<string, Job>
}

const finalReview = load(
  readFileSync('.github/workflows/final-code-review.yml', 'utf8'),
) as Workflow
const ci = load(readFileSync('.github/workflows/ci.yml', 'utf8')) as Workflow
const requestReview = load(
  readFileSync('.github/workflows/ci-request-final-code-review.yml', 'utf8'),
) as Workflow

describe('final code review workflow', () => {
  it('uses a non-cancelling label-triggered lane and a stable gate', () => {
    expect(finalReview.concurrency?.['cancel-in-progress']).toBe(false)
    expect(finalReview.jobs?.['code-reviewed']?.name).toContain('Publish final review result')
    expect(finalReview.jobs?.['code-reviewed']?.name).not.toMatch(/['"]Code Reviewed['"]/)
    expect(finalReview.jobs?.['code-reviewed']?.needs).toEqual(
      expect.arrayContaining([
        'validate-review-settings',
        'opencode-code-review',
        'opencode-zen-code-review',
      ]),
    )
  })

  it('requires a successful tests job for the exact live head and never reviews drafts', () => {
    const selector = finalReview.jobs?.['select-final-review']
    expect(selector?.permissions?.actions).toBe('read')
    const script = selector?.steps?.at(0)?.run ?? ''
    expect(script).toContain('--commit "$head_sha" --event pull_request')
    expect(script).toContain('.name == "tests" and .conclusion == "success"')
    expect(script).toContain('if [ "$is_draft" = true ]; then')
    expect(selector?.permissions?.checks).toBe('read')
    expect(script).toContain('commits/$commit_sha/check-runs')
    expect(script).toContain('.app.slug == "github-actions"')
    expect(script).toContain('gate_status invalid-complete')
  })

  it('fails closed when organization settings are absent', () => {
    const settingsStep = finalReview.jobs?.['validate-review-settings']?.steps?.at(0)
    expect(settingsStep?.env).toMatchObject({
      OPENROUTER_ENABLED: '${{ vars.OPENCODE_CODE_REVIEW_ENABLED }}',
      OPENROUTER_MODEL: '${{ vars.OPENCODE_CODE_REVIEW_MODEL }}',
      ZEN_ENABLED: '${{ vars.OPENCODE_ZEN_CODE_REVIEW_ENABLED }}',
      ZEN_MODEL: '${{ vars.OPENCODE_ZEN_CODE_REVIEW_MODEL }}',
    })
    expect(settingsStep?.env).not.toHaveProperty('REVIEW_REQUIRED')
  })

  it('keeps provider failures advisory while preserving orchestration failures', () => {
    const gate = finalReview.jobs?.['code-reviewed']
    const validate = gate?.steps?.find((step) => step.name === 'Validate final review outcome')
    const script = validate?.run ?? ''

    expect(script).toContain('Review selection failed')
    expect(script).toContain('Review settings are invalid')
    expect(script).toContain('review did not complete successfully')
    expect(script).not.toContain('REVIEW_REQUIRED')
    expect(script).not.toContain('A required code review provider failed')
  })

  it.each([
    ['opencode-code-review', 'OPENROUTER_FREE_API_KEY', 'OPENCODE_CODE_REVIEW_MODEL'],
    ['opencode-zen-code-review', 'OPENCODE_FREE_API_KEY', 'OPENCODE_ZEN_CODE_REVIEW_MODEL'],
  ])('isolates %s from write permissions and PR-controlled actions', (jobName, secret, model) => {
    const job = finalReview.jobs?.[jobName]
    expect(job?.['continue-on-error']).toBe(true)
    expect(job?.permissions?.['pull-requests']).toBe('read')
    expect(job?.permissions?.issues).toBe('read')
    const reviewStep = job?.steps?.find((step) => step.uses?.includes('opencode-code-review'))
    expect(reviewStep?.uses).toBe('./.trusted-review-action/.github/actions/opencode-code-review')
    expect(reviewStep?.with?.model).toBe(`\${{ vars.${model} }}`)
    expect(Object.values(reviewStep?.with ?? {})).toContain(`\${{ secrets.${secret} }}`)
    expect(reviewStep?.with?.prompt_path).toBe('docs/prompts/code-review.md')
  })

  it('posts only from trusted action code with pull-request write permission', () => {
    for (const jobName of ['opencode-code-review-poster', 'opencode-zen-code-review-poster']) {
      const job = finalReview.jobs?.[jobName]
      expect(job?.permissions?.['pull-requests']).toBe('write')
      expect(
        job?.steps?.some((step) => step.name === 'Require the selected PR head before posting'),
      ).toBe(true)
      const poster = job?.steps?.find((step) => step.uses?.includes('code-review-poster'))
      expect(poster?.uses).toBe('./.trusted-review-action/.github/actions/code-review-poster')
      expect(poster?.with?.token_source).toBe('github-token')
    }
  })

  it('publishes the stable gate as an explicit check run on the selected PR head', () => {
    const gate = finalReview.jobs?.['code-reviewed']
    expect(gate?.permissions?.checks).toBe('write')
    expect(gate?.permissions?.issues).toBeUndefined()
    expect(gate?.permissions?.['pull-requests']).toBe('write')
    const publish = gate?.steps?.find(
      (step) => step.name === 'Publish Code Reviewed on the PR head',
    )
    expect(publish?.env?.SELECTED_HEAD_SHA).toBe(
      '${{ needs.select-final-review.outputs.head_sha }}',
    )
    expect(publish?.run).toContain('repos/$GITHUB_REPOSITORY/check-runs')
    expect(publish?.run).toContain("-f name='Code Reviewed'")
    expect(publish?.run).toContain('-f "head_sha=$SELECTED_HEAD_SHA"')
  })
})

describe('CI final review fan-in', () => {
  it('cancels stale CI runs but exposes the stable tests gate', () => {
    expect(ci.concurrency?.['cancel-in-progress']).toBe(true)
    expect(ci.jobs?.tests?.name).toBe('tests')
    expect(ci.jobs?.tests?.needs).toEqual(['test', 'actionlint'])
  })

  it('passes untrusted PRs separately from the privileged request workflow', () => {
    expect(ci.jobs?.['request-final-code-review']).toBeUndefined()
    expect(ci.jobs?.['untrusted-code-reviewed']?.name).toContain('Code Reviewed')
    expect(ci.jobs?.['untrusted-code-reviewed']?.needs).toEqual(['tests'])
    const ciText = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(ciText).toContain('github.event.pull_request.user.login')
    for (const login of [
      'dependabot',
      'dependabot[bot]',
      'app/dependabot',
      'renovate',
      'renovate[bot]',
      'app/renovate',
    ]) {
      expect(ciText).toContain(`github.event.pull_request.user.login == '${login}'`)
      expect(ciText).toContain(`github.event.pull_request.user.login != '${login}'`)
    }
    expect(ciText).not.toContain("github.actor == 'dependabot[bot]'")
  })

  it('uses default-branch workflow_run code and GITHUB_TOKEN to request trusted reviews', () => {
    const job = requestReview.jobs?.['request-final-code-review']
    expect(job?.permissions).toMatchObject({
      actions: 'write',
      'pull-requests': 'write',
    })
    expect(job?.permissions?.issues).toBeUndefined()
    const script = job?.steps?.at(0)?.run ?? ''
    expect(script).toContain('gh run view "$SOURCE_RUN_ID"')
    expect(script).toContain('.name == "tests" and .conclusion == "success"')
    expect(script).toContain('gh workflow run final-code-review.yml')
    expect(script).not.toContain('CODE_REVIEW_TRIGGER_TOKEN')
  })

  it('recognizes REST and GraphQL dependency-bot identities', () => {
    const requestScript = requestReview.jobs?.['request-final-code-review']?.steps?.at(0)?.run ?? ''
    const selectScript = finalReview.jobs?.['select-final-review']?.steps?.at(0)?.run ?? ''
    const botCasePattern =
      /dependabot\|'dependabot\[bot\]'\|app\/dependabot\|renovate\|'renovate\[bot\]'\|app\/renovate/

    for (const script of [requestScript, selectScript]) {
      expect(script).toMatch(botCasePattern)
    }
  })
})
