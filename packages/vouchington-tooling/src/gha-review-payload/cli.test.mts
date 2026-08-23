import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runStageReviewPayloadCli } from './cli.mts'

describe('runStageReviewPayloadCli', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stderr.mockClear()
  })

  it('stages a required payload and writes staged=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage-review-'))
    const source = join(dir, 'code-review-payload.json')
    const dest = join(dir, 'ready')
    const output = join(dir, 'github-output')
    writeFileSync(source, '{"body":"ok","comments":[]}')
    writeFileSync(output, '')
    const previous = process.env.GITHUB_OUTPUT
    process.env.GITHUB_OUTPUT = output
    try {
      expect(runStageReviewPayloadCli(['required', source, dest])).toBe(0)
      expect(readFileSync(output, 'utf8')).toContain('staged=true')
    } finally {
      if (previous === undefined) delete process.env.GITHUB_OUTPUT
      else process.env.GITHUB_OUTPUT = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes staged=false for an optional missing payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage-review-missing-'))
    const output = join(dir, 'github-output')
    writeFileSync(output, '')
    const previous = process.env.GITHUB_OUTPUT
    process.env.GITHUB_OUTPUT = output
    try {
      expect(
        runStageReviewPayloadCli(['optional', join(dir, 'missing.json'), join(dir, 'ready')]),
      ).toBe(0)
      expect(readFileSync(output, 'utf8')).toContain('staged=false')
    } finally {
      if (previous === undefined) delete process.env.GITHUB_OUTPUT
      else process.env.GITHUB_OUTPUT = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a bad requirement, arity, and missing GITHUB_OUTPUT', () => {
    expect(runStageReviewPayloadCli(['maybe', 'a', 'b'])).toBe(1)
    expect(runStageReviewPayloadCli(['required', 'a'])).toBe(1)
    expect(runStageReviewPayloadCli(['required', 'a', 'b', 'c'])).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toContain('optional or required')
  })
})
