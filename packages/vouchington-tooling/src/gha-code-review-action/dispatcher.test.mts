import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Workflow = {
  jobs?: Record<
    string,
    {
      uses?: string
      with?: Record<string, string>
    }
  >
  on?: {
    workflow_call?: {
      inputs?: Record<string, { type?: string }>
      outputs?: Record<string, { value?: string }>
    }
    workflow_dispatch?: { inputs?: Record<string, { type?: string }> }
  }
}

const text = readFileSync('.github/workflows/claude-code-review.yml', 'utf8')
const workflow = load(text) as Workflow

describe('claude code review dispatcher', () => {
  it('stringifies required_review at the reusable workflow_call boundary', () => {
    expect(workflow.on?.workflow_call?.inputs?.tooling_ref?.type).toBe('string')
    expect(workflow.on?.workflow_dispatch?.inputs?.required_review?.type).toBe('boolean')
    expect(workflow.jobs?.['claude-review']?.uses).toBe('./.github/workflows/code-review.yml')
    expect(workflow.jobs?.['claude-review']?.with?.required_review).toBe(
      "${{ (inputs.required_review == true || inputs.required_review == 'true') && 'true' || 'false' }}",
    )
    expect(workflow.jobs?.['claude-review']?.with?.tooling_ref).toBe(
      '${{ inputs.tooling_ref || github.sha }}',
    )
    expect(workflow.jobs?.['claude-review']?.with?.compatibility_warning).toBe(false)
    expect(text).not.toContain('required_review: ${{ inputs.required_review }}')
  })

  it('forwards the nested workflow outputs to callers', () => {
    expect(workflow.on?.workflow_call?.outputs).toEqual({
      agent_outcome: {
        description: 'Advisory Claude review-agent outcome.',
        value: '${{ jobs.claude-review.outputs.agent_outcome }}',
      },
      payload_artifact_id: {
        description: 'Review payload artifact ID when a payload was produced.',
        value: '${{ jobs.claude-review.outputs.payload_artifact_id }}',
      },
      poster_outcome: {
        description: 'Advisory Claude review-poster outcome.',
        value: '${{ jobs.claude-review.outputs.poster_outcome }}',
      },
    })
  })
})
