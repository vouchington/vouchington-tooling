import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./snapshot.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./snapshot.mts')>()),
  defaultExec: vi.fn(async () => JSON.stringify({ structured_output: { findings: [] } })),
  prepareSnapshot: vi.fn(async () => ({ dir: '/snap', diff: '', body: '' })),
}))

import { runFinalReviewBenchCli } from './cli.mts'
import { defaultExec, prepareSnapshot } from './snapshot.mts'

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('runFinalReviewBenchCli default dependencies', () => {
  it('reads and writes the real filesystem and logs to stderr', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-defaults-'))
    dirs.push(dir)
    const cases = join(dir, 'cases.json')
    const prompts = join(dir, 'prompts')
    const out = join(dir, 'nested', 'out')
    writeFileSync(
      cases,
      JSON.stringify([
        {
          id: 'n1',
          repo: 'acme/widgets',
          pr: 1,
          title: 'n1',
          baseSha: 'a'.repeat(40),
          headSha: 'b'.repeat(40),
          kind: 'negative',
          expected: [],
        },
      ]),
    )
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await expect(
      runFinalReviewBenchCli([
        '--cases',
        cases,
        '--out',
        out,
        '--prompts',
        prompts,
        '--pillar',
        'rules',
      ]),
    ).rejects.toThrow()
    mkdirSync(prompts)
    writeFileSync(join(prompts, 'rules.md'), 'Rules prompt')

    await expect(
      runFinalReviewBenchCli([
        '--cases',
        cases,
        '--out',
        out,
        '--prompts',
        prompts,
        '--pillar',
        'rules',
      ]),
    ).resolves.toBe(0)
    expect(stderr).toHaveBeenCalledWith('snapshot n1\n')
    expect(stderr).toHaveBeenCalledWith('run rules n1\n')
    expect(prepareSnapshot).toHaveBeenCalled()
    expect(defaultExec).toHaveBeenCalled()
    expect(existsSync(join(out, 'raw', 'rules', 'n1.json'))).toBe(true)
    expect(readFileSync(join(out, 'summary.md'), 'utf8')).toContain('| rules | 1 |')

    await expect(
      runFinalReviewBenchCli(['--cases', cases, '--out', out, '--score-only', '--pillar', 'rules']),
    ).resolves.toBe(0)
  })
})
