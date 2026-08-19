import { afterEach, describe, expect, it, vi } from 'vitest'

import { runGhaRuntimeAudit } from './gha-runtime-audit.mts'
import { parseCli } from '../parse.mts'
import type { GhApiExecutor } from '../../gha-runtime-audit/index.mts'

const execute: GhApiExecutor = async (request) => {
  if (request.endpoint.includes('/actions/workflows?')) {
    return { workflows: [{ id: 1, name: 'CI', state: 'active' }] }
  }
  if (request.endpoint.includes('/runs?')) {
    return {
      workflow_runs: [
        {
          id: 1,
          name: 'CI',
          event: 'pull_request',
          conclusion: 'success',
          created_at: '2026-01-01T00:00:00.000Z',
          html_url: 'https://github.test/runs/1',
          head_branch: 'main',
          pull_requests: [{ base: { ref: 'main' } }],
        },
      ],
    }
  }
  return {
    jobs: [
      {
        id: 10,
        name: 'test',
        started_at: '2026-01-01T00:00:00.000Z',
        completed_at: '2026-01-01T00:01:00.000Z',
        conclusion: 'success',
        html_url: 'https://github.test/jobs/10',
      },
    ],
  }
}

describe('runGhaRuntimeAudit', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stdout.mockClear()
    stderr.mockClear()
  })

  it('prints JSON for a configured repository', async () => {
    const parsed = parseCli([
      'node',
      'vouchington',
      'gha-runtime-audit',
      '--repository',
      'owner/repo',
      '--pr-workflow',
      'CI',
      '--branch',
      'main',
    ])
    if (parsed.kind !== 'gha-runtime-audit') throw new Error('expected gha-runtime-audit')
    expect(await runGhaRuntimeAudit(parsed, execute)).toBe(0)
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('"CI / test"')
  })

  it('reads GITHUB_REPOSITORY when --repository is omitted', async () => {
    const parsed = parseCli(['node', 'vouchington', 'gha-runtime-audit', '--pr-workflow', 'CI'])
    if (parsed.kind !== 'gha-runtime-audit') throw new Error('expected gha-runtime-audit')
    expect(await runGhaRuntimeAudit(parsed, execute, { GITHUB_REPOSITORY: 'owner/repo' })).toBe(0)
  })

  it('requires a repository', async () => {
    const parsed = parseCli(['node', 'vouchington', 'gha-runtime-audit', '--pr-workflow', 'CI'])
    if (parsed.kind !== 'gha-runtime-audit') throw new Error('expected gha-runtime-audit')
    expect(await runGhaRuntimeAudit(parsed, execute, {})).toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('GITHUB_REPOSITORY')
  })
})
