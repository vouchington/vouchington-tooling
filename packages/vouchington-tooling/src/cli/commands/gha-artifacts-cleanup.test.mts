import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runCli } from '../index.mts'
import { loadCleanupPatterns, runGhaArtifactsCleanup } from './gha-artifacts-cleanup.mts'

const ENV = { GITHUB_TOKEN: 'test-token', GITHUB_REPOSITORY: 'owner/repo' }

describe('gha-artifacts-cleanup CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns 0 without calling the API when the token or repository is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn<typeof fetch>())
    await expect(
      runGhaArtifactsCleanup(
        {
          kind: 'gha-artifacts-cleanup',
          subcommand: 'run',
          runId: '1',
          keepPatterns: [],
          deletePatterns: [],
        },
        { GITHUB_REPOSITORY: 'owner/repo' },
      ),
    ).resolves.toBe(0)
    await expect(
      runGhaArtifactsCleanup(
        {
          kind: 'gha-artifacts-cleanup',
          subcommand: 'run',
          runId: '1',
          keepPatterns: [],
          deletePatterns: [],
        },
        { GITHUB_TOKEN: 'test-token' },
      ),
    ).resolves.toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts GH_TOKEN and runs both subcommands against stubbed fetch', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () => new Response(JSON.stringify({ artifacts: [] }), { status: 200 }),
        ),
    )
    await expect(
      runGhaArtifactsCleanup(
        {
          kind: 'gha-artifacts-cleanup',
          subcommand: 'run',
          runId: '42',
          keepPatterns: ['plan-*'],
          deletePatterns: ['coverage-*'],
        },
        { GH_TOKEN: 'gh-token', GITHUB_REPOSITORY: 'owner/repo' },
      ),
    ).resolves.toBe(0)
    await expect(
      runGhaArtifactsCleanup(
        {
          kind: 'gha-artifacts-cleanup',
          subcommand: 'sweep',
          olderThanHours: 6,
          keepPatterns: [],
          deletePatterns: [],
        },
        ENV,
      ),
    ).resolves.toBe(0)
    expect(fetch).toHaveBeenCalled()
  })

  it('prints usage when a parsed run or sweep is missing its required field', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      runGhaArtifactsCleanup(
        { kind: 'gha-artifacts-cleanup', subcommand: 'run', keepPatterns: [], deletePatterns: [] },
        ENV,
      ),
    ).resolves.toBe(2)
    await expect(
      runGhaArtifactsCleanup(
        {
          kind: 'gha-artifacts-cleanup',
          subcommand: 'sweep',
          keepPatterns: [],
          deletePatterns: [],
        },
        ENV,
      ),
    ).resolves.toBe(2)
    expect(error).toHaveBeenCalled()
  })

  it('merges patterns from a JSON file with CLI flags', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'artifact-patterns-'))
    const file = join(directory, 'patterns.json')
    await writeFile(file, JSON.stringify({ keep: ['plan-*'], delete: ['coverage-*'] }))
    try {
      expect(
        loadCleanupPatterns({
          kind: 'gha-artifacts-cleanup',
          subcommand: 'run',
          runId: '1',
          keepPatterns: ['static-*'],
          deletePatterns: ['report-*'],
          patternsFile: file,
        }),
      ).toEqual({
        keepPatterns: ['plan-*', 'static-*'],
        deletePatterns: ['coverage-*', 'report-*'],
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('dispatches through runCli', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () => new Response(JSON.stringify({ artifacts: [] }), { status: 200 }),
        ),
    )
    const previousToken = process.env.GITHUB_TOKEN
    const previousRepo = process.env.GITHUB_REPOSITORY
    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_REPOSITORY = 'owner/repo'
    try {
      await expect(
        runCli([
          'node',
          'vouchington',
          'gha-artifacts-cleanup',
          'run',
          '--run-id',
          '7',
          '--keep-pattern',
          'plan-*',
        ]),
      ).resolves.toBe(0)
    } finally {
      if (previousToken === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = previousToken
      if (previousRepo === undefined) delete process.env.GITHUB_REPOSITORY
      else process.env.GITHUB_REPOSITORY = previousRepo
    }
  })
})
