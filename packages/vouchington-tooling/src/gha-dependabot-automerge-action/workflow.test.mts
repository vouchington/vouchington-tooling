import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Workflow = {
  on?: { pull_request_target?: { types?: string[] } }
  jobs?: Record<string, { if?: string; steps?: Array<{ uses?: string }> }>
}

const path = '.github/workflows/dependabot-automerge.yml'
const source = readFileSync(path, 'utf8')
const workflow = load(source) as Workflow

describe('Dependabot auto-merge workflow', () => {
  it('enables once per PR and keeps edited for retarget cleanup', () => {
    expect(workflow.on?.pull_request_target?.types).toEqual([
      'opened',
      'reopened',
      'ready_for_review',
      'edited',
    ])
    expect(source).not.toContain('synchronize')
    expect(source).not.toContain('converted_to_draft')
    expect(workflow.jobs?.automerge?.if).toContain("github.event.action == 'opened'")
    expect(workflow.jobs?.automerge?.if).toContain("github.event.action == 'reopened'")
    expect(workflow.jobs?.automerge?.if).toContain("github.event.action == 'ready_for_review'")
    expect(workflow.jobs?.['cleanup-retargeted-automerge']?.if).toContain(
      'github.event.pull_request.base.ref != github.event.repository.default_branch',
    )
    expect(
      workflow.jobs?.automerge?.steps?.some((step) =>
        step.uses?.includes('.github/actions/dependabot-automerge'),
      ),
    ).toBe(true)
  })
})
