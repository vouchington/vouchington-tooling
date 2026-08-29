import { readFileSync } from 'node:fs'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

type Workflow = {
  jobs: Record<
    string,
    { permissions: Record<string, string>; steps: Array<{ name?: string; run?: string }> }
  >
  on: { workflow_dispatch: { inputs: Record<string, unknown> } }
}

const text = readFileSync('.github/workflows/release.yml', 'utf8')
const workflow = parse(text) as Workflow
const prepare = workflow.jobs.prepare!
const publish = workflow.jobs.publish!

const namedStepRun = (job: (typeof workflow.jobs)[string], name: string): string =>
  job.steps.find((step) => step.name === name)?.run ?? ''

describe('release workflow', () => {
  it('splits protected-main preparation from OIDC publication', () => {
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      'action',
      'package',
      'bump',
      'version',
      'pr',
    ])
    expect(prepare.permissions).toEqual({
      contents: 'read',
    })
    expect(publish.permissions).toEqual({ contents: 'read', 'id-token': 'write' })
    expect(text).not.toContain('HEAD:main')
    expect(text).not.toContain('--follow-tags')
  })

  it('guards branch trees, exact merged commits, tags, npm, and release creation', () => {
    const prepareRun = namedStepRun(prepare, 'Prepare release PR')
    const publishRun = namedStepRun(publish, 'Tag and publish merged release')
    expect(prepareRun).toContain('refs/heads/$BRANCH')
    expect(prepareRun).toContain('git ls-remote --exit-code --tags')
    expect(prepareRun).toContain('EXPECTED_TREE=$(git write-tree)')
    expect(prepareRun).toContain('origin/$BRANCH^{tree}')
    const validationRun = namedStepRun(
      publish,
      'Validate merged release PR and checkout its merge commit',
    )
    expect(validationRun).toContain("grep -Eq '^[1-9][0-9]*$'")
    expect(validationRun).toContain("grep -Eq '^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$'")
    expect(validationRun).toContain('gh pr view "$PR"')
    expect(validationRun).toContain('headRefName')
    expect(validationRun).toContain('origin/main:packages/$PACKAGE/package.json')
    expect(validationRun).toContain('git merge-base --is-ancestor')
    expect(validationRun).toContain('git checkout --detach "$MERGE"')
    expect(validationRun).toContain("require('./packages/'")
    expect(publishRun).toContain('refs/tags/$TAG^{}')
    expect(publishRun).toContain('test -n "$PEELED"')
    expect(publishRun).toContain('curl --fail-with-body')
    expect(publishRun).toContain('test "$STATUS" = 404')
    expect(publishRun).toContain('node scripts/verify-release-metadata.mts')
    expect(publishRun.indexOf('verify-release-metadata.mts')).toBeLessThan(
      publishRun.indexOf('git push origin "$TAG"'),
    )
    expect(publishRun).toContain('npm publish --access public')
    expect(publishRun).toContain('gh release view "$TAG"')
  })
})
