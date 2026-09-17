import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import * as githubProjects from './index.mts'

describe('github-projects subpath', () => {
  it('publishes the built github-projects subpath contract', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, unknown> }
    expect(manifest.exports['./github-projects']).toEqual({
      default: './dist/github-projects/index.mjs',
      import: './dist/github-projects/index.mjs',
      types: './dist/github-projects/index.d.mts',
    })
  })

  it('re-exports the public audit and query surface', () => {
    expect(githubProjects.auditProjectCompletion).toBeTypeOf('function')
    expect(githubProjects.formatProjectAdvisories).toBeTypeOf('function')
    expect(githubProjects.formatProjectAdvisoryReport).toBeTypeOf('function')
    expect(githubProjects.groupClosedIssuesByProject).toBeTypeOf('function')
    expect(githubProjects.fetchIssueProjectMemberships).toBeTypeOf('function')
    expect(githubProjects.findProjectCompletionSiblings).toBeTypeOf('function')
    expect(githubProjects.isProjectScopeError).toBeTypeOf('function')
    expect(githubProjects.buildIssueProjectItemsArgs).toBeTypeOf('function')
    expect(githubProjects.buildProjectItemsArgs).toBeTypeOf('function')
    expect(githubProjects.DEFAULT_PROJECT_COMPLETION_REMAINDER).toBe(3)
  })
})
