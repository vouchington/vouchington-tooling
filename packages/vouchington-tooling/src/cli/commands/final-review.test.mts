import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../../final-review/benchmark/cli.mts', () => ({
  runFinalReviewBenchCli: vi.fn(async () => 5),
}))

import type { FinalReviewIo } from '../../final-review/index.mts'
import { runFinalReviewBenchCli } from '../../final-review/benchmark/cli.mts'
import { runFinalReviewCommand, type FinalReviewDeps } from './final-review.mts'

const SHA = 'e'.repeat(40)

type MockIo = { [K in keyof FinalReviewIo]: Mock<FinalReviewIo[K]> }

function fakeIo(overrides: Partial<MockIo> = {}): MockIo {
  return {
    headSha: vi.fn(async () => SHA),
    listFiles: vi.fn(async () => []),
    listReviewBodies: vi.fn(async () => []),
    hasApprovalLabel: vi.fn(async () => true),
    postReview: vi.fn(async () => 'https://example.test/r'),
    addApprovalLabel: vi.fn(async () => undefined),
    removeApprovalLabel: vi.fn(async () => undefined),
    ...overrides,
  }
}

type MockDeps = { [K in keyof FinalReviewDeps]: Mock<FinalReviewDeps[K]> }

function deps(io: FinalReviewIo, input = '{}'): MockDeps {
  return {
    createIo: vi.fn(() => io),
    readFile: vi.fn(() => input),
    runBench: vi.fn(async () => 7),
  }
}

const PR = ['--repo', 'acme/widgets', '--pr', '4']

function capture() {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk))
    return true
  })
  return { out, err }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runFinalReviewCommand', () => {
  it('forwards bench arguments without parsing them', async () => {
    const d = deps(fakeIo())
    await expect(runFinalReviewCommand(['bench', '--cases', 'c'], d)).resolves.toBe(7)
    expect(d.runBench).toHaveBeenCalledWith(['--cases', 'c'])
    expect(d.createIo).not.toHaveBeenCalled()
  })

  it('posts a dry run and prints the full outcome', async () => {
    const { out } = capture()
    const d = deps(fakeIo(), JSON.stringify({ findings: [] }))
    await expect(
      runFinalReviewCommand(
        ['post', ...PR, '--head-sha', SHA, '--input', 'f.json', '--dry-run'],
        d,
      ),
    ).resolves.toBe(0)
    expect(d.createIo).toHaveBeenCalledWith({ repo: 'acme/widgets', pr: 4 })
    expect(d.readFile).toHaveBeenCalledWith('f.json')
    const printed = JSON.parse(out.join(''))
    expect(printed).toMatchObject({ verdict: 'Approve', label: 'unchanged' })
    expect(Array.isArray(printed.reviews)).toBe(true)
  })

  it('posts for real and prints only the review count', async () => {
    const { out } = capture()
    const io = fakeIo()
    const d = deps(io, JSON.stringify({ findings: [] }))
    await expect(
      runFinalReviewCommand(['post', ...PR, '--head-sha', SHA, '--input', 'f.json'], d),
    ).resolves.toBe(0)
    expect(io.postReview).toHaveBeenCalledOnce()
    expect(JSON.parse(out.join(''))).toMatchObject({
      verdict: 'Approve',
      reviews: 1,
      urls: ['https://example.test/r'],
      label: 'added',
    })
  })

  it('requires --head-sha and --input for post', async () => {
    const { err } = capture()
    const d = deps(fakeIo())
    await expect(runFinalReviewCommand(['post', ...PR, '--input', 'f'], d)).resolves.toBe(2)
    await expect(runFinalReviewCommand(['post', ...PR, '--head-sha', SHA], d)).resolves.toBe(2)
    expect(err.join('')).toBe(
      'final-review: post needs --head-sha and --input.\nfinal-review: post needs --head-sha and --input.\n',
    )
  })

  it('revokes the approval label', async () => {
    const { out } = capture()
    const io = fakeIo()
    await expect(runFinalReviewCommand(['revoke', ...PR], deps(io))).resolves.toBe(0)
    expect(io.removeApprovalLabel).toHaveBeenCalledOnce()
    expect(JSON.parse(out.join(''))).toEqual({ removed: true })
  })

  it('exits 0 for an approved status and 1 otherwise', async () => {
    const { out } = capture()
    const approved = fakeIo({
      listReviewBodies: vi.fn(async () => [
        `<!-- final-review sha=${SHA} verdict=Approve effort=high -->`,
      ]),
    })
    await expect(runFinalReviewCommand(['status', ...PR], deps(approved))).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ approved: true })
    await expect(runFinalReviewCommand(['status', ...PR], deps(fakeIo()))).resolves.toBe(1)
  })

  it('reports usage and validation errors with exit code 2', async () => {
    const { err } = capture()
    const d = deps(fakeIo())
    await expect(runFinalReviewCommand(['status', '--pr', '4'], d)).resolves.toBe(2)
    await expect(runFinalReviewCommand(['status', '--repo', 'a/b'], d)).resolves.toBe(2)
    await expect(runFinalReviewCommand([], d)).resolves.toBe(2)
    await expect(runFinalReviewCommand(['wat', ...PR], d)).resolves.toBe(2)
    await expect(runFinalReviewCommand(['status', '--bogus'], d)).resolves.toBe(2)
    expect(err.join('')).toContain('final-review: --repo and --pr are required.')
    expect(err.join('')).toContain(
      'final-review: final-review needs post, revoke, status, or bench.',
    )
  })

  it('stringifies non-Error failures', async () => {
    const { err } = capture()
    const d = deps(fakeIo())
    d.createIo.mockImplementation(() => {
      throw 'not an error'
    })
    await expect(runFinalReviewCommand(['status', ...PR], d)).resolves.toBe(2)
    expect(err.join('')).toBe('final-review: not an error\n')
  })
})

describe('runFinalReviewCommand default dependencies', () => {
  it('reads input from disk, builds a gh io, and delegates bench', async () => {
    const { err } = capture()
    const dir = mkdtempSync(join(tmpdir(), 'final-review-cmd-'))
    try {
      const file = join(dir, 'findings.json')
      writeFileSync(file, '{"findings": 3}')
      // Real file read and JSON parse happen before any gh call; the invalid findings abort first.
      await expect(
        runFinalReviewCommand(['post', ...PR, '--head-sha', SHA, '--input', file]),
      ).resolves.toBe(2)
      expect(err.join('')).toContain('findings must be an array.')
      // A malformed repo is rejected by the default gh io factory without running gh.
      await expect(runFinalReviewCommand(['status', '--repo', 'bad', '--pr', '1'])).resolves.toBe(2)
      expect(err.join('')).toContain('--repo must be owner/name.')
      await expect(runFinalReviewCommand(['bench', '--x'])).resolves.toBe(5)
      expect(runFinalReviewBenchCli).toHaveBeenCalledWith(['--x'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
