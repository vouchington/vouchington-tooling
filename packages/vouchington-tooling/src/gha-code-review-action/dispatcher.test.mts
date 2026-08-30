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
    workflow_dispatch?: { inputs?: Record<string, { type?: string }> }
  }
}

const text = readFileSync('.github/workflows/claude-code-review.yml', 'utf8')
const workflow = load(text) as Workflow

describe('claude code review dispatcher', () => {
  it('stringifies required_review at the reusable workflow_call boundary', () => {
    expect(workflow.on?.workflow_dispatch?.inputs?.required_review?.type).toBe('boolean')
    expect(workflow.jobs?.['claude-review']?.uses).toBe('./.github/workflows/code-review.yml')
    expect(workflow.jobs?.['claude-review']?.with?.required_review).toBe(
      "${{ (inputs.required_review == true || inputs.required_review == 'true') && 'true' || 'false' }}",
    )
    expect(workflow.jobs?.['claude-review']?.with?.tooling_ref).toBe('${{ github.sha }}')
    expect(text).not.toContain('required_review: ${{ inputs.required_review }}')
  })
})
