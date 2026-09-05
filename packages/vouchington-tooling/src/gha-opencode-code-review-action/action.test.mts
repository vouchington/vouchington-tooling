import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type CompositeStep = {
  'continue-on-error'?: boolean
  name?: string
  id?: string
  if?: string
  env?: Record<string, string>
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

type CompositeAction = {
  inputs?: Record<string, { required?: boolean; default?: string; description?: string }>
  outputs?: Record<string, { value?: string }>
  runs?: { steps?: CompositeStep[] }
}

const actionText = readFileSync('.github/actions/opencode-code-review/action.yml', 'utf8')
const action = load(actionText) as CompositeAction
const steps = action.runs?.steps ?? []
const stepByName = new Map(steps.map((step) => [step.name, step]))

describe('opencode-code-review action', () => {
  it('does not accept a free-text prompt input', () => {
    expect(action.inputs).not.toHaveProperty('prompt')
    expect(actionText).not.toContain('issue_comment')
    expect(actionText).not.toContain('@claude')
    expect(stepByName.get('Build review prompt')?.run).toContain('build-prompt.sh')
    expect(stepByName.get('Build review prompt')?.env?.EXTRA_PROMPT).toBe(
      '${{ inputs.extra_prompt }}',
    )
    expect(stepByName.get('Build review prompt')?.env?.REPO_PRIVATE).toBe(
      '${{ github.event.repository.private }}',
    )
  })

  it('checks out the trusted prompt into a workspace-relative path', () => {
    expect(stepByName.get('Stash existing trusted prompt directory')?.run).toContain(
      'stash-trusted-prompt-dir.sh',
    )
    expect(stepByName.get('Checkout trusted review prompt')?.with).toMatchObject({
      path: '.trusted-review-prompt',
      'persist-credentials': false,
    })
    expect(stepByName.get('Clean review payload files')?.run).toContain(
      'restore-trusted-prompt-dir.sh',
    )
    expect(stepByName.get('Clear leftover review payload')?.run).not.toContain(
      '.vouchington-tooling',
    )
    expect(stepByName.get('Clean review payload files')?.run).not.toContain('.vouchington-tooling')
  })

  it('materializes PR context with the job token and keeps gh away from the model', () => {
    const materialize = stepByName.get('Materialize PR review context')
    const review = stepByName.get('Run OpenCode Review')
    expect(materialize?.env?.GH_TOKEN).toBe('${{ github.token }}')
    expect(materialize?.run).toContain('scripts/gha/materialize-pr-context.sh')
    expect(review?.env?.GH_TOKEN).toBe('')
    expect(review?.env?.GITHUB_TOKEN).toBe('')
    expect(review?.run).not.toContain('gh ')
    expect(actionText).not.toContain('install-vouchington-tooling.sh')
    expect(actionText).not.toContain('anomalyco/opencode/github')
  })

  it('runs a pinned OpenCode CLI with review-only permissions', () => {
    const review = stepByName.get('Run OpenCode Review')
    const install = stepByName.get('Install pinned OpenCode CLI')
    expect(install?.env?.OPENCODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(actionText).toContain(
      '# renovate: datasource=github-releases depName=anomalyco/opencode extractVersion=^v(?<version>.*)$',
    )
    expect(review?.run).toContain('"$OPENCODE_BIN" run')
    expect(review?.run).toContain('--agent code-review')
    expect(review?.env?.OPENCODE_PERMISSION).toContain('"bash":"deny"')
    expect(review?.env?.OPENCODE_PERMISSION).toContain('"external_directory":"deny"')
    expect(review?.env?.HOME).toBe('${{ steps.opencode-home.outputs.home }}')
    expect(stepByName.get('Isolate OpenCode install home')?.run).toContain(
      'home="${RUNNER_TEMP}/opencode-home"',
    )
    expect(review?.run).toContain('install-review-project.sh')
    expect(stepByName.get('Clean review payload files')?.run).toContain('restore-review-project.sh')
  })

  it('bounds timeout_seconds to 1-3600 and skips cleanly instead of failing outside that range', () => {
    const review = stepByName.get('Run OpenCode Review')
    expect(action.inputs?.timeout_seconds).toMatchObject({
      default: '1200',
      description: expect.stringContaining('30-second termination grace'),
    })
    expect(review?.env?.TIMEOUT_SECONDS).toBe('${{ inputs.timeout_seconds }}')
    const validator = review?.run?.match(/case "\$TIMEOUT_SECONDS" in[\s\S]*?\nfi\n/)?.[0]
    expect(validator).toBeDefined()

    const root = mkdtempSync(join(tmpdir(), 'opencode-timeout-'))
    const outputPath = join(root, 'github-output')
    try {
      for (const value of ['1', '9', '10', '999', '1000', '3599', '3600']) {
        writeFileSync(outputPath, '')
        const result = spawnSync('bash', ['-c', validator!], {
          encoding: 'utf8',
          env: { ...process.env, TIMEOUT_SECONDS: value, GITHUB_OUTPUT: outputPath },
        })
        expect({ value, stderr: result.stderr, output: readFileSync(outputPath, 'utf8') }).toEqual({
          value,
          stderr: '',
          output: '',
        })
      }
      for (const value of ['', '0', '00', '3601', '-1', '1.5', '3600 ']) {
        writeFileSync(outputPath, '')
        spawnSync('bash', ['-c', validator!], {
          encoding: 'utf8',
          env: { ...process.env, TIMEOUT_SECONDS: value, GITHUB_OUTPUT: outputPath },
        })
        expect(readFileSync(outputPath, 'utf8')).toContain('skipped=true')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
    expect(review?.run).toContain('must be a positive integer no greater than 3600')
    expect(review?.run).toContain('run-with-timeout.sh not found relative to GITHUB_ACTION_PATH')
    expect(review?.run).toContain('run-with-timeout.sh" "$TIMEOUT_SECONDS" 30')
    expect(review?.['continue-on-error']).toBe(true)
  })

  it('skips instead of failing when the model or every provider key is missing', () => {
    const review = stepByName.get('Run OpenCode Review')
    const root = mkdtempSync(join(tmpdir(), 'opencode-skip-'))
    const outputPath = join(root, 'github-output')
    const baseEnv = {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      OPENCODE_MODEL: 'opencode/muse-spark-1.3-contributor-free',
      OPENROUTER_API_KEY: '',
      OPENCODE_API_KEY: 'key',
      TIMEOUT_SECONDS: '1200',
    }
    try {
      writeFileSync(outputPath, '')
      const missingModel = spawnSync('bash', ['-c', review!.run!], {
        encoding: 'utf8',
        env: { ...baseEnv, OPENCODE_MODEL: '' },
      })
      expect(missingModel.status).toBe(0)
      expect(readFileSync(outputPath, 'utf8')).toContain('skipped=true')

      writeFileSync(outputPath, '')
      const missingKeys = spawnSync('bash', ['-c', review!.run!], {
        encoding: 'utf8',
        env: { ...baseEnv, OPENCODE_API_KEY: '' },
      })
      expect(missingKeys.status).toBe(0)
      expect(readFileSync(outputPath, 'utf8')).toContain('skipped=true')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('never lets a downstream step turn the check run red', () => {
    for (const name of [
      'Stash existing trusted prompt directory',
      'Checkout trusted review prompt',
      'Build review prompt',
      'Clear leftover review payload',
      'Isolate OpenCode install home',
      'Materialize PR review context',
      'Install pinned OpenCode CLI',
      'Resolve trusted Node version',
      'Setup trusted Node for payload handoff',
      'Run OpenCode Review',
      'Stage review payload artifact',
      'Upload review payload',
      'Clean review payload files',
    ]) {
      expect(stepByName.get(name)?.['continue-on-error']).toBe(true)
    }
    expect(stepByName.get('Record agent outcome')?.['continue-on-error']).toBeUndefined()
  })

  it('stages the payload through the same-ref CLI and a unique artifact name', () => {
    expect(stepByName.get('Stage review payload artifact')?.run).toContain(
      'gha-review-payload/cli.mts',
    )
    expect(stepByName.get('Upload review payload')?.with).toMatchObject({
      name: 'code-review-payload-${{ inputs.payload_artifact_name }}',
      'retention-days': 1,
    })
    expect(action.outputs).toMatchObject({
      agent_outcome: { value: '${{ steps.agent-result.outputs.agent_outcome }}' },
      payload_artifact_id: { value: '${{ steps.upload-payload.outputs.artifact-id }}' },
    })
  })

  it('reuses the code-review Node resolver', () => {
    expect(stepByName.get('Resolve trusted Node version')?.run).toContain(
      '../code-review/resolve-node-version.sh',
    )
  })
})
