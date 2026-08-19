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

  it('stamps a bundle from GitHub identity and rejects invalid usage', () => {
    root = mkdtempSync(join(tmpdir(), 'vitest-blob-cli-'))
    const reports = join(root, 'reports')
    mkdirSync(reports)
    writeFileSync(join(reports, 'tooling.json'), '{}')
    const env = {
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_RUN_ID: '9131',
    }
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
