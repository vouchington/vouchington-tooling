import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = readFileSync(join(root, '.github/workflows/label-pr.yml'), 'utf8')
const workflow = load(source) as {
  permissions: Record<string, string>
  on: { workflow_call: { inputs: Record<string, { default?: string }> } }
  jobs: {
    label: {
      steps: Array<{
        uses?: string
        'continue-on-error'?: boolean
        with?: Record<string, string>
      }>
    }
  }
}

describe('label-pr reusable workflow', () => {
  it('labels with the caller config and pull-request write permission', () => {
    expect(workflow.on.workflow_call.inputs['configuration-path']?.default).toBe(
      '.github/labeler.yml',
    )
    expect(workflow.on.workflow_call.inputs['runs-on']?.default).toBe('ubuntu-slim')
    expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' })
    const step = workflow.jobs.label.steps[0]
    expect(step?.uses).toBe('actions/labeler@bf12e9b00b37c5c0ca2b87b79b2daf7891dbda13')
    expect(step?.['continue-on-error']).toBe(true)
    expect(step?.with).toEqual({
      'repo-token': '${{ secrets.GITHUB_TOKEN }}',
      'configuration-path': '${{ inputs.configuration-path }}',
    })
    expect(source).not.toMatch(/voucha|filament|storybook|vouchington-machines/iu)
  })
})
