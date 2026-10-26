import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  name?: string
  id?: string
  uses?: string
  env?: Record<string, string>
  run?: string
  with?: Record<string, unknown>
  'continue-on-error'?: boolean
  'working-directory'?: string
}

interface Workflow {
  on: {
    workflow_call: {
      inputs: Record<string, { required?: boolean; type: string; default?: unknown }>
    }
  }
  permissions: Record<string, string>
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: {
    'cleanup-sweep': {
      permissions: Record<string, string>
      steps: Step[]
    }
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const workflowText = readFileSync(join(root, '.github/workflows/cleanup-artifacts.yml'), 'utf8')
const workflow = load(workflowText) as Workflow
const job = workflow.jobs['cleanup-sweep']
const steps = job.steps
const validate = steps.find((step) => step.name === 'Validate sweep inputs')
const sweep = steps.find((step) => step.name === 'Sweep artifacts')

function runValidate(env: Record<string, string>) {
  return spawnSync('bash', ['-c', validate?.run ?? 'exit 99'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  })
}

describe('cleanup-artifacts reusable workflow', () => {
  it('calls the existing sweep CLI with caller-owned inputs', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_call'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(job.permissions).toEqual({ actions: 'write', contents: 'read' })
    expect(workflow.on.workflow_call.inputs['older-than-hours']).toMatchObject({
      default: '6',
      type: 'string',
    })
    expect(workflow.on.workflow_call.inputs['patterns-file']?.required).toBe(true)
    expect(workflow.concurrency).toEqual({
      group: 'cleanup-artifacts-sweep',
      'cancel-in-progress': false,
    })
    expect(sweep?.['continue-on-error']).toBe(true)
    expect(sweep?.env?.GITHUB_TOKEN).toBe('${{ github.token }}')
    expect(sweep?.run).toContain('gha-artifacts-cleanup sweep')
    expect(sweep?.run).toContain('--patterns-file')
    expect(workflowText).not.toContain('cleanup-artifacts.mts')
    expect(workflowText).not.toContain('sparse-checkout')
    expect(workflowText).not.toContain('secrets: inherit')
    expect(workflowText).not.toMatch(/voucha|filament|storybook|vouchington-machines|openai/iu)
  })

  it('checks out this workflow repository at the called SHA', () => {
    const tooling = steps.find((step) => step.name === 'Checkout tooling')
    expect(workflowText).not.toContain('workflow_ref')
    expect(tooling?.with).toMatchObject({
      repository: 'vouchington/vouchington-tooling',
      ref: '${{ job.workflow_sha }}',
      path: '.tooling',
      'fetch-depth': 1,
      'persist-credentials': false,
    })
    const setupNode = steps.findIndex((step) => step.uses?.startsWith('actions/setup-node'))
    const setupPnpm = steps.findIndex((step) => step.uses?.startsWith('pnpm/setup@'))
    expect(setupPnpm).toBeGreaterThan(setupNode)
    expect(steps[setupPnpm]?.with).toEqual({
      version: 'latest-12',
      install: false,
      'node-version-file': false,
    })
    expect(
      steps.find((step) => step.name === 'Install and build the CLI')?.['working-directory'],
    ).toBe('.tooling')
  })

  it('rejects a sweep threshold or patterns path that is not an existing repository file', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'cleanup-artifacts-'))
    mkdirSync(join(workspace, 'ci'))
    writeFileSync(join(workspace, 'ci/patterns.json'), '[]')
    const run = (hours: string, file: string) =>
      runValidate({ OLDER_THAN_HOURS: hours, PATTERNS_FILE: file, GITHUB_WORKSPACE: workspace })
    try {
      expect(run('6', 'ci/patterns.json').status).toBe(0)
      expect(run('6a', 'ci/patterns.json').status).toBe(2)
      expect(run('6', '../patterns.json').status).toBe(2)
      expect(run('6', '/tmp/patterns.json').status).toBe(2)
      const missing = run('6', 'ci/missing.json')
      expect(missing.status).toBe(2)
      expect(missing.stdout).toContain('::error::patterns-file ci/missing.json does not exist')
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
