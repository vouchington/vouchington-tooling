import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Step = {
  env?: Record<string, string>
  id?: string
  name?: string
  run?: string
}

type Workflow = {
  jobs?: Record<string, { steps?: Step[] }>
  on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } }
}

const workflowText = readFileSync('.github/workflows/release.yml', 'utf8')
const workflow = load(workflowText) as Workflow

describe('release workflow', () => {
  it('publishes the release commit and its explicit tag atomically', () => {
    expect(workflow.on?.workflow_dispatch?.inputs).toMatchObject({
      package: expect.any(Object),
      bump: expect.any(Object),
    })

    const steps = workflow.jobs?.release?.steps ?? []
    const bump = steps.find((step) => step.id === 'bump')
    const push = steps.find((step) => step.run?.startsWith('git push '))
    const publish = steps.find((step) => step.name === 'Publish with npm OIDC')
    const release = steps.find((step) => step.name === 'Create GitHub release')

    expect(bump?.run).toContain('git tag -a "${PACKAGE}/v${VERSION}"')
    expect(push?.run).toBe('git push --atomic origin HEAD:main "refs/tags/${PACKAGE}/v${VERSION}"')
    expect(push?.env).toEqual({
      PACKAGE: '${{ inputs.package }}',
      VERSION: '${{ steps.bump.outputs.version }}',
    })
    expect(push?.run).not.toContain('--follow-tags')
    expect(workflowText.match(/git push/g)).toHaveLength(1)
    expect(steps.indexOf(bump!)).toBeLessThan(steps.indexOf(push!))
    expect(steps.indexOf(push!)).toBeLessThan(steps.indexOf(publish!))

    expect(release?.run).toContain(
      'gh release create "${{ inputs.package }}/v${{ steps.bump.outputs.version }}"',
    )
  })

  it('uses a slash-separated tag so Dependabot recognizes it as a version', () => {
    const steps = workflow.jobs?.release?.steps ?? []
    const bump = steps.find((step) => step.id === 'bump')

    // Mirrors Dependabot::GithubActions::Version.remove_leading_v, which strips a
    // slash-delimited monorepo prefix but never a hyphen-joined one.
    const dependabotRecognizesVersion = (tag: string) => /^(?:.*\/)?v?[0-9]/.test(tag)

    expect(dependabotRecognizesVersion('vouchington-tooling/v0.7.0')).toBe(true)
    expect(dependabotRecognizesVersion('vouchington-tooling-v0.7.0')).toBe(false)
    expect(bump?.run).toContain('"${PACKAGE}/v${VERSION}"')
  })
})
