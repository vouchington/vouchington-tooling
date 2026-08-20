import { describe, expect, it, vi } from 'vitest'

import { createArtifactClassifier } from './classify.mts'
import { runCleanup, sweepCleanup, type CleanupDeps } from './commands.mts'
import type { GithubArtifact } from './github.mts'

const REPO = 'owner/repo'
const TOKEN = 'test-token'
const classify = createArtifactClassifier({
  keepPatterns: ['plan-*'],
  deletePatterns: ['coverage-*'],
}).classify

function artifact(overrides: Partial<GithubArtifact> = {}): GithubArtifact {
  return {
    id: 1,
    name: 'coverage-unit',
    size_in_bytes: 100,
    expired: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function fakeDeps(overrides: Partial<CleanupDeps> = {}): CleanupDeps {
  return {
    listRunArtifacts: vi.fn<CleanupDeps['listRunArtifacts']>().mockResolvedValue([]),
    listArtifactsPage: vi.fn<CleanupDeps['listArtifactsPage']>().mockResolvedValue(null),
    getRunConclusion: vi.fn<CleanupDeps['getRunConclusion']>().mockResolvedValue(null),
    deleteArtifact: vi.fn<CleanupDeps['deleteArtifact']>().mockResolvedValue('deleted'),
    ...overrides,
  }
}

describe('runCleanup', () => {
  it('deletes the delete-classified, non-expired artifacts of a run', async () => {
    const deps = fakeDeps({
      listRunArtifacts: vi
        .fn<CleanupDeps['listRunArtifacts']>()
        .mockResolvedValue([
          artifact({ id: 1, name: 'coverage-unit', size_in_bytes: 10 }),
          artifact({ id: 2, name: 'plan-main' }),
          artifact({ id: 3, name: 'coverage-unit', expired: true }),
        ]),
    })
    const summary = await runCleanup({ repo: REPO, token: TOKEN, runId: '999', classify, deps })
    expect(deps.deleteArtifact).toHaveBeenCalledExactlyOnceWith(REPO, TOKEN, 1)
    expect(summary).toEqual({ deletedCount: 1, bytesFreed: 10 })
  })

  it('logs and continues past a failed delete', async () => {
    const deps = fakeDeps({
      listRunArtifacts: vi
        .fn<CleanupDeps['listRunArtifacts']>()
        .mockResolvedValue([artifact({ id: 1 }), artifact({ id: 2 })]),
      deleteArtifact: vi
        .fn<CleanupDeps['deleteArtifact']>()
        .mockResolvedValueOnce('failed')
        .mockResolvedValueOnce('deleted'),
    })
    const log = vi.fn<(message: string) => void>()
    const summary = await runCleanup({
      repo: REPO,
      token: TOKEN,
      runId: '999',
      classify,
      deps,
      log,
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('failed to delete'))
    expect(summary).toEqual({ deletedCount: 1, bytesFreed: 100 })
  })

  it('logs failed deletes on console.error when no log function is injected', async () => {
    const deps = fakeDeps({
      listRunArtifacts: vi
        .fn<CleanupDeps['listRunArtifacts']>()
        .mockResolvedValue([artifact({ id: 1 })]),
      deleteArtifact: vi.fn<CleanupDeps['deleteArtifact']>().mockResolvedValue('failed'),
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const summary = await runCleanup({ repo: REPO, token: TOKEN, runId: '999', classify, deps })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('failed to delete'))
    expect(summary).toEqual({ deletedCount: 0, bytesFreed: 0 })
    error.mockRestore()
  })

  it('does not count already-deleted (not-found) artifacts as freed', async () => {
    const deps = fakeDeps({
      listRunArtifacts: vi
        .fn<CleanupDeps['listRunArtifacts']>()
        .mockResolvedValue([artifact({ id: 1 }), artifact({ id: 2 })]),
      deleteArtifact: vi
        .fn<CleanupDeps['deleteArtifact']>()
        .mockResolvedValueOnce('not-found')
        .mockResolvedValueOnce('deleted'),
    })
    const summary = await runCleanup({ repo: REPO, token: TOKEN, runId: '999', classify, deps })
    expect(summary).toEqual({ deletedCount: 1, bytesFreed: 100 })
  })
})

describe('sweepCleanup', () => {
  it('pages through artifacts, checks run conclusions, and deletes eligible ones', async () => {
    const oldSuccess = artifact({
      id: 1,
      created_at: '2020-01-01T00:00:00Z',
      workflow_run: { id: 10 },
    })
    const oldFailed = artifact({
      id: 2,
      created_at: '2020-01-01T00:00:00Z',
      workflow_run: { id: 20 },
    })
    const tooNew = artifact({ id: 3, created_at: '2099-01-01T00:00:00Z', workflow_run: { id: 30 } })
    const deps = fakeDeps({
      listArtifactsPage: vi
        .fn<CleanupDeps['listArtifactsPage']>()
        .mockResolvedValueOnce([oldSuccess, oldFailed, tooNew])
        .mockResolvedValueOnce([]),
      getRunConclusion: vi.fn<CleanupDeps['getRunConclusion']>(async (_repo, _token, runId) =>
        runId === 10 ? 'success' : 'failure',
      ),
    })
    const summary = await sweepCleanup({
      repo: REPO,
      token: TOKEN,
      olderThanHours: 6,
      classify,
      deps,
    })
    expect(deps.deleteArtifact).toHaveBeenCalledExactlyOnceWith(REPO, TOKEN, 1)
    expect(summary.deletedCount).toBe(1)
  })

  it('stops paging when a page request fails', async () => {
    const deps = fakeDeps({
      listArtifactsPage: vi.fn<CleanupDeps['listArtifactsPage']>().mockResolvedValue(null),
    })
    const summary = await sweepCleanup({
      repo: REPO,
      token: TOKEN,
      olderThanHours: 6,
      classify,
      deps,
    })
    expect(deps.listArtifactsPage).toHaveBeenCalledOnce()
    expect(summary).toEqual({ deletedCount: 0, bytesFreed: 0 })
  })
})
