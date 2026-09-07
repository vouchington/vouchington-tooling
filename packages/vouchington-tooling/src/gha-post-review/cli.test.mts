import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runPostReviewCli } from './cli.mts'
import * as github from './github.mts'

describe('runPostReviewCli', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 0 after a successful post and forwards the comment count', async () => {
    vi.spyOn(github, 'postReviewFromEnv').mockResolvedValue({ posted: true, commentCount: 3 })
    const writePostedOutput = vi.spyOn(github, 'writePostedOutput').mockImplementation(() => {})
    await expect(runPostReviewCli({})).resolves.toBe(0)
    expect(writePostedOutput).toHaveBeenCalledWith(true, 3, undefined)
  })

  it('returns 1 and prints Error for a thrown Error', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(github, 'postReviewFromEnv').mockRejectedValue(new Error('boom'))
    await expect(runPostReviewCli({})).resolves.toBe(1)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toBe('Error: boom\n')
  })

  it('returns 1 and prints Error for a non-Error throw', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(github, 'postReviewFromEnv').mockRejectedValue('nope')
    await expect(runPostReviewCli({})).resolves.toBe(1)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toBe('Error: nope\n')
  })
})

describe('runPostReviewCli output', () => {
  it('writes posted to GITHUB_OUTPUT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-review-cli-'))
    const output = join(dir, 'out')
    writeFileSync(output, '')
    vi.spyOn(github, 'postReviewFromEnv').mockResolvedValue({ posted: true, commentCount: 2 })
    try {
      await expect(runPostReviewCli({ GITHUB_OUTPUT: output })).resolves.toBe(0)
      expect(readFileSync(output, 'utf8')).toBe('posted=true\ncomment_count=2\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      vi.restoreAllMocks()
    }
  })
})
