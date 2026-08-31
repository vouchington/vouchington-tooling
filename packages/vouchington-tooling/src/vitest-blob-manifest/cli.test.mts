import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runVitestBlobManifestCommand } from '../cli/commands/vitest-blob-manifest.mts'
import { inspectVitestBlobBundle } from './index.mts'
import { runVitestBlobManifestCli } from './cli.mts'

const revision = 'a'.repeat(40)

describe('vitest-blob-manifest CLI', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  function fixture(): { env: NodeJS.ProcessEnv; reports: string } {
    root = mkdtempSync(join(tmpdir(), 'vitest-blob-cli-'))
    const reports = join(root, 'reports')
    mkdirSync(reports)
    writeFileSync(join(reports, 'tooling.json'), '{}')
    return {
      env: {
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_RUN_ID: '9131',
      },
      reports,
    }
  }

  it.each(['02', '2.0', ' 2', '2 ', '0x2', '1e0', '0', '-2', 'NaN', '9007199254740992'])(
    'rejects non-canonical GitHub run attempt %j',
    (attempt) => {
      const { env, reports } = fixture()
      expect(() =>
        runVitestBlobManifestCli(
          ['tooling', reports],
          { ...env, GITHUB_RUN_ATTEMPT: attempt },
          revision,
        ),
      ).toThrow('GITHUB_RUN_ATTEMPT must be a positive integer')
    },
  )

  it.each(['1', '2', '9007199254740991'])('accepts canonical GitHub run attempt %s', (attempt) => {
    const { env, reports } = fixture()
    runVitestBlobManifestCli(
      ['tooling', reports],
      { ...env, GITHUB_RUN_ATTEMPT: attempt },
      revision,
    )
    expect(inspectVitestBlobBundle(reports).manifest.run.attempt).toBe(Number(attempt))
  })

  it('stamps a bundle from GitHub identity and rejects invalid usage', () => {
    const { env, reports } = fixture()
    runVitestBlobManifestCli(['tooling', reports], env, revision)
    expect(inspectVitestBlobBundle(reports).manifest).toMatchObject({
      repository: 'owner/repo',
      revision,
      suite: 'tooling',
      run: { id: '9131', attempt: 2 },
    })
    expect(() =>
      runVitestBlobManifestCli(['tooling', reports], { ...env, GITHUB_RUN_ATTEMPT: '0' }, revision),
    ).toThrow('positive integer')
    expect(() => runVitestBlobManifestCli([], env, revision)).toThrow('Usage')
    expect(() =>
      runVitestBlobManifestCli(['tooling', reports], { ...env, GITHUB_RUN_ATTEMPT: '' }, revision),
    ).toThrow('Usage')
    expect(() =>
      runVitestBlobManifestCli(
        ['tooling', reports],
        { ...env, GITHUB_RUN_ATTEMPT: undefined },
        revision,
      ),
    ).toThrow('Usage')
    expect(() =>
      runVitestBlobManifestCli(['tooling', reports], { ...env, GITHUB_REPOSITORY: '' }, revision),
    ).toThrow('GITHUB_REPOSITORY is required')
  })

  it('returns 0 from the command wrapper on success and 1 on failure', () => {
    root = mkdtempSync(join(tmpdir(), 'vitest-blob-cli-wrap-'))
    const reports = join(root, 'reports')
    mkdirSync(reports)
    writeFileSync(join(reports, 'tooling.json'), '{}')
    const previous = {
      GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
      GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT,
      GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
    }
    process.env.GITHUB_REPOSITORY = 'owner/repo'
    process.env.GITHUB_RUN_ATTEMPT = '1'
    process.env.GITHUB_RUN_ID = '9'
    const writes: string[] = []
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    try {
      expect(runVitestBlobManifestCommand(['tooling', reports])).toBe(0)
      expect(runVitestBlobManifestCommand([])).toBe(1)
      expect(writes.join('')).toContain('Usage')
      expect(runVitestBlobManifestCommand(['tooling', reports, 'extra'])).toBe(1)
    } finally {
      stderr.mockRestore()
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
