import { readFileSync } from 'node:fs'

import { parse as load } from 'yaml'
import { describe, expect, it } from 'vitest'

type Step = {
  env?: Record<string, string>
  id?: string
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

type Workflow = {
  permissions?: Record<string, string>
  jobs?: Record<
    string,
    {
      steps?: Step[]
      needs?: string
      permissions?: Record<string, string>
      outputs?: Record<string, string>
      env?: Record<string, string | number>
    }
  >
  on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } }
}

const workflowText = readFileSync('.github/workflows/release.yml', 'utf8')
const workflow = load(workflowText) as Workflow

describe('release workflow', () => {
  it('keeps browser execution outside the credentialed publishing runner', () => {
    const validation = workflow.jobs?.['browser-validation']
    const release = workflow.jobs?.release
    const steps = validation?.steps ?? []
    const source = steps.find((step) => step.id === 'source')
    const browser = steps.find((step) => step.run?.includes('playwright install'))
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'))
    const publishCheckout = release?.steps?.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    )

    expect(workflow.permissions).toEqual({})
    expect(validation?.permissions).toEqual({ contents: 'read' })
    expect(release?.permissions).toEqual({ contents: 'write', 'id-token': 'write' })
    expect(release?.needs).toBe('browser-validation')
    expect(checkout?.with).toEqual({ ref: 'main', 'persist-credentials': false })
    expect(source?.run).toContain('git rev-parse HEAD')
    expect(steps.indexOf(source!)).toBeLessThan(steps.indexOf(browser!))
    expect(validation?.outputs?.['source-sha']).toBe('${{ steps.source.outputs.sha }}')
    expect(publishCheckout?.with?.ref).toBe('${{ needs.browser-validation.outputs.source-sha }}')
    expect(steps.some((step) => step.run === 'pnpm run test:coverage')).toBe(true)
    for (const gate of ['typecheck', 'build', 'lint', 'test:coverage', 'actionlint'])
      expect(
        steps.some((step) => step.run === `pnpm run ${gate}`),
        gate,
      ).toBe(true)
    expect(JSON.stringify(validation)).not.toMatch(/secrets\.|npm publish|upload-artifact/)
    expect(JSON.stringify(release)).not.toMatch(/playwright|test:coverage|download-artifact/)
    for (const job of [validation, release])
      expect(job?.env).toEqual({ GOMEMLIMIT: '8GiB', GOMAXPROCS: 2 })
  })

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
