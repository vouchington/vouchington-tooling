import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Action = {
  inputs?: Record<string, { default?: string; required?: boolean }>
  outputs?: Record<string, { value?: string }>
  runs?: { steps?: Array<{ env?: Record<string, string>; run?: string }> }
}

function action(path: string): Action {
  return load(readFileSync(path, 'utf8')) as Action
}

describe('event-driven final-review actions', () => {
  const root = '.github/actions'

  it('selects one completed validation snapshot without polling', () => {
    const select = action(`${root}/select-final-review/action.yml`)
    expect(select.inputs).toMatchObject({
      'read-token': { required: true },
      'requested-label': { required: true },
      'workflow-path': { required: true },
      'fan-in-job': { required: true },
      'forbidden-success-job': { default: '' },
      'retry-attempts': { default: '3' },
    })
    expect(select.inputs).not.toHaveProperty('poll-attempts')
    expect(select.inputs).not.toHaveProperty('poll-seconds')
    expect(Object.keys(select.outputs ?? {})).toEqual([
      'should_review',
      'gate_status',
      'pr_number',
      'head_sha',
      'base_sha',
    ])

    const script = readFileSync(`${root}/select-final-review/select-final-review.sh`, 'utf8')
    expect(script).toContain('.status == "completed"')
    expect(script).toContain('sort_by(.created_at, .id) | last')
    expect(script).toContain('EVENT_LABEL')
    expect(script).not.toContain('POLL_')
    expect(script).not.toMatch(/for attempt in.*seq/)
  })

  it('routes one exact completed source run with separate mutation credentials', () => {
    const request = action(`${root}/request-final-review/action.yml`)
    expect(request.inputs).toMatchObject({
      'read-token': { required: true },
      'write-token': { required: true },
      'source-run-id': { required: true },
      'source-workflow-path': { required: true },
      'fan-in-job': { required: true },
      'review-workflow-path': { required: true },
      'review-check-name': { required: true },
      'retry-attempts': { default: '3' },
    })
    expect(request.runs?.steps?.[0]?.env).toMatchObject({
      READ_TOKEN: '${{ inputs.read-token }}',
      WRITE_TOKEN: '${{ inputs.write-token }}',
    })

    const script = readFileSync(`${root}/request-final-review/request-final-review.sh`, 'utf8')
    expect(script).toContain('GH_TOKEN="$WRITE_TOKEN" gh_retry')
    expect(script).toContain(
      'Source workflow identity, event, head, or completion state did not match.',
    )
    expect(script).toContain('.head_repository.full_name == $head_repo')
    expect(script).toContain('Could not resolve exactly one open pull request')
    expect(script).toContain('check-runs')
  })
})
