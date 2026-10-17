import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  id?: string
  if?: string
  uses?: string
  with?: Record<string, string>
  env?: Record<string, string>
  run?: string
}

interface Workflow {
  name: string
  on: {
    workflow_call: {
      inputs: Record<string, { required?: boolean; type: string; default?: unknown }>
      outputs: Record<string, unknown>
      secrets: Record<string, { required: boolean }>
    }
  }
  permissions: Record<string, string>
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: {
    dispatch: {
      if: string
      environment: string
      'runs-on': string
      outputs: Record<string, string>
      steps: Step[]
    }
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const workflowText = readFileSync(join(root, '.github/workflows/harness-dispatch.yml'), 'utf8')
const workflow = load(workflowText) as Workflow
const job = workflow.jobs.dispatch
const prepare = job.steps.find((step) => step.id === 'prepare')
const dispatch = job.steps.find((step) => step.id === 'dispatch')
const resume = job.steps.find((step) => step.id === 'resume')
const sha = /^jonathanong\/auto-harness\/actions\/dispatch@[0-9a-f]{40}$/u

describe('harness-dispatch reusable workflow contract', () => {
  it('keeps the bounded call contract and exposes only session outputs', () => {
    expect(workflow.name).toBe('Harness Dispatch')
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.on.workflow_call.secrets)).toEqual(['HARNESS_API_KEY'])
    expect(workflow.on.workflow_call.secrets.HARNESS_API_KEY?.required).toBe(true)
    expect(workflow.on.workflow_call.inputs).toMatchObject({
      'agent-ref': { required: true, type: 'string' },
      'concurrency-id': { required: true, type: 'string' },
      'expected-head-sha': { required: true, type: 'string' },
      'surface-gate': { required: true, type: 'string' },
      prompt: { required: true, type: 'string' },
    })
    expect(Object.keys(workflow.on.workflow_call.outputs)).toEqual([
      'session-id',
      'session-url',
      'created',
    ])
    expect(workflow.concurrency).toEqual({
      group: 'harness-dispatch-${{ inputs.concurrency-id }}',
      'cancel-in-progress': false,
    })
    expect(Object.keys(workflow.jobs)).toEqual(['dispatch'])
  })

  it('turns product-specific defaults into inputs', () => {
    const inputs = workflow.on.workflow_call.inputs
    expect(inputs.environment?.default).toBe('auto-harness')
    expect(inputs['dispatch-ref']?.default).toBe('refs/heads/main')
    expect(inputs['runs-on']?.default).toBe('ubuntu-slim')
    expect(inputs['target-variable']?.default).toBe('HARNESS_TARGET')
    expect(inputs['fallbacks-variable']?.default).toBe('HARNESS_FALLBACKS')
    expect(inputs.priority?.default).toBe('20')
    expect(inputs['queue-ttl-seconds']?.default).toBe('3600')
    expect(inputs['timeout-seconds']?.default).toBe('6300')
    expect(inputs['required-labels']?.default).toBe('[]')
    expect(job.environment).toBe('${{ inputs.environment }}')
    expect(job['runs-on']).toBe('${{ inputs.runs-on }}')
  })

  it('gates the credential-bearing job on ref, first attempt, and repository variables', () => {
    expect(job.if).toContain('github.ref == inputs.dispatch-ref')
    expect(job.if).toContain('github.run_attempt == 1')
    expect(job.if).toContain("vars.HARNESS_DISPATCH_ENABLED == 'true'")
    expect(job.if).toContain("vars[inputs.surface-gate] == 'true'")
    expect(job.if).toContain(
      "(inputs.additional-gate == '' || vars[inputs.additional-gate] == 'true')",
    )
  })

  it('pins the dispatch action by SHA and never checks out or inherits secrets', () => {
    expect(dispatch?.uses).toMatch(sha)
    expect(resume?.uses).toMatch(sha)
    expect(dispatch?.uses).toBe(resume?.uses)
    expect(job.steps.some((step) => step.uses?.startsWith('actions/checkout'))).toBe(false)
    expect(workflowText).not.toContain('secrets: inherit')
    expect(workflowText).not.toMatch(/vouchington|voucha/iu)
  })

  it('dispatches by SHA with target and fallbacks read from the named variables', () => {
    expect(dispatch?.if).toBe("inputs.resume-session-id == ''")
    expect(dispatch?.with).toMatchObject({
      'api-key': '${{ secrets.HARNESS_API_KEY }}',
      'repository-id': '${{ vars.HARNESS_REPOSITORY_ID }}',
      'server-url': '${{ vars.HARNESS_URL }}',
      ref: '${{ inputs.expected-head-sha }}',
      target: '${{ vars[inputs.target-variable] || vars.HARNESS_TARGET }}',
      fallbacks: '${{ vars[inputs.fallbacks-variable] || vars.HARNESS_FALLBACKS }}',
      metadata: '${{ steps.prepare.outputs.metadata }}',
      source: 'webhook',
    })
    expect(resume?.if).toBe("inputs.resume-session-id != ''")
    expect(resume?.with).toMatchObject({
      operation: 'resume',
      'session-id': '${{ inputs.resume-session-id }}',
    })
    expect(job.outputs['session-id']).toBe(
      '${{ steps.dispatch.outputs.session-id || steps.resume.outputs.session-id }}',
    )
  })
})

describe('harness-dispatch prepare step', () => {
  const env = {
    AGENT_REF: 'main',
    COMPLETION_MODE: 'pr',
    EXPECTED_HEAD_SHA: 'a'.repeat(40),
    HARNESS_PROMPT: 'do it',
    HARNESS_URL: 'https://harness.example',
    PUBLISH_CONTRACT: 'none',
    PUBLISH_RELATED_CANDIDATES: '[]',
    EXISTING_ISSUE_MAINTENANCE: 'false',
    RESUME_SESSION_ID: '',
  }

  function run(overrides: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'harness-dispatch-'))
    const output = join(dir, 'output')
    const blank = Object.fromEntries(Object.keys(prepare?.env ?? {}).map((key) => [key, '']))
    const result = spawnSync('bash', ['-c', prepare?.run ?? ''], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...blank, ...env, ...overrides },
    })
    const written = result.status === 0 ? readFileSync(output, 'utf8') : ''
    const metadata = written.startsWith('metadata=')
      ? (JSON.parse(written.slice('metadata='.length)) as Record<string, string>)
      : undefined
    return { ...result, metadata }
  }

  it('emits only non-empty metadata fields', () => {
    const result = run({ PUBLISH_TITLE_PREFIX: '[auto] ' })
    expect(result.status).toBe(0)
    expect(result.metadata).toEqual({
      agentRef: 'main',
      completionMode: 'pr',
      existingIssueMaintenance: 'false',
      expectedHeadSha: env.EXPECTED_HEAD_SHA,
      publishContract: 'none',
      publishTitlePrefix: '[auto] ',
    })
  })

  it('keeps small related candidates and drops oversized ones with a warning', () => {
    const small = run({ PUBLISH_RELATED_CANDIDATES: '[{"number":1}]' })
    expect(small.metadata?.publishRelatedCandidates).toBe('[{"number":1}]')
    const large = run({ PUBLISH_RELATED_CANDIDATES: JSON.stringify([{ title: 'x'.repeat(600) }]) })
    expect(large.status).toBe(0)
    expect(large.metadata).not.toHaveProperty('publishRelatedCandidates')
    expect(large.stdout).toContain('publish-related-candidates dropped')
  })

  it('rejects invalid input', () => {
    expect(run({ HARNESS_URL: 'http://harness.example' }).stdout).toContain('https://')
    expect(run({ HARNESS_PROMPT: 'x'.repeat(65_537) }).stdout).toContain('65536 bytes')
    expect(run({ RESUME_SESSION_ID: 'nope' }).stdout).toContain('not a valid session id')
    expect(run({ PUBLISH_RELATED_CANDIDATES: '{}' }).stdout).toContain('must be a JSON array')
    expect(run({ PUBLISH_BASE_REF: 'x'.repeat(513) }).stdout).toContain('publishBaseRef')
    expect(run({ RESUME_SESSION_ID: 'sess-0123abcd' }).status).toBe(0)
  })
})
