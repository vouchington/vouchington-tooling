import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const fetchAction = readFileSync('.github/actions/fetch-repository-paths/action.yml', 'utf8')
const cleanAction = readFileSync('.github/actions/clean-workspace/action.yml', 'utf8')

describe('repository path fetch action', () => {
  it('invokes the CLI with the locked contract and returns immutable metadata', () => {
    expect(fetchAction).toContain('fetch-repository-paths')
    expect(fetchAction).toContain('--config')
    expect(fetchAction).toContain('--destination')
    expect(fetchAction).toContain('--metadata')
    expect(fetchAction).toContain('--token-env FETCH_REPOSITORY_PATHS_TOKEN')
    expect(fetchAction).toContain('FETCH_REPOSITORY_PATHS_CONFIG: ${{ inputs.config }}')
    expect(fetchAction).toContain('--config "$FETCH_REPOSITORY_PATHS_CONFIG"')
    expect(fetchAction).not.toContain('--config "${{ inputs.config }}"')
    expect(fetchAction).toContain('resolved_sha')
    expect(fetchAction).toContain('digest')
  })

  it('delegates workspace cleanup to the canonical CLI command', () => {
    expect(cleanAction).toContain('clean-workspace')
    expect(cleanAction).toContain('src/cli/index.mts')
  })
})
