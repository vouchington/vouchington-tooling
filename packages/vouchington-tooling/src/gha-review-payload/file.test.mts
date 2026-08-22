import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MAX_REVIEW_PAYLOAD_BYTES, ReviewPayloadError } from './payload.mts'
import { readRegularReviewPayload, stageReviewPayload, writeStagedOutput } from './file.mts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('review payload file boundary', () => {
  it('reads only bounded regular files and allows optional absence', () => {
    const root = mkdtempSync(join(tmpdir(), 'gha-review-payload-'))
    roots.push(root)
    const source = join(root, 'payload.json')
    writeFileSync(source, '{}')
    expect(readRegularReviewPayload(source, 'required')).toEqual(Buffer.from('{}'))
    expect(readRegularReviewPayload(join(root, 'missing'), 'optional')).toBeUndefined()
    expect(() => readRegularReviewPayload(join(root, 'missing'), 'required')).toThrow(
      ReviewPayloadError,
    )
    expect(() => readRegularReviewPayload(null as unknown as string, 'required')).toThrow(TypeError)
  })

  it('rejects directories, symlinks, empty files, and oversized files', () => {
    const root = mkdtempSync(join(tmpdir(), 'gha-review-payload-'))
    roots.push(root)
    const target = join(root, 'target')
    const link = join(root, 'link')
    writeFileSync(target, '{}')
    symlinkSync(target, link)
    expect(() => readRegularReviewPayload(root, 'required')).toThrow(ReviewPayloadError)
    expect(() => readRegularReviewPayload(link, 'required')).toThrow(ReviewPayloadError)
    const empty = join(root, 'empty')
    writeFileSync(empty, '')
    expect(() => readRegularReviewPayload(empty, 'required')).toThrow(ReviewPayloadError)
    const huge = join(root, 'huge')
    writeFileSync(huge, Buffer.alloc(MAX_REVIEW_PAYLOAD_BYTES + 1))
    expect(() => readRegularReviewPayload(huge, 'required')).toThrow(ReviewPayloadError)
  })

  it('replaces stale output with private staged permissions', () => {
    const root = mkdtempSync(join(tmpdir(), 'gha-review-payload-'))
    roots.push(root)
    const source = join(root, 'payload.json')
    const destination = join(root, 'stage')
    writeFileSync(source, '{"body":"fresh"}')
    writeFileSync(destination, 'stale')
    const staged = stageReviewPayload(source, destination, 'required')!
    expect(readFileSync(staged, 'utf8')).toBe('{"body":"fresh"}')
    expect(lstatSync(destination).mode & 0o777).toBe(0o700)
    expect(lstatSync(staged).mode & 0o777).toBe(0o600)
  })

  it('does not create a staging directory for an optional missing payload', () => {
    const root = mkdtempSync(join(tmpdir(), 'gha-review-payload-'))
    roots.push(root)
    const destination = join(root, 'stage')
    expect(stageReviewPayload(join(root, 'missing'), destination, 'optional')).toBeUndefined()
  })

  it('writes a single safe output and rejects output injection', () => {
    const root = mkdtempSync(join(tmpdir(), 'gha-review-payload-'))
    roots.push(root)
    const output = join(root, 'github-output')
    writeStagedOutput('review-path', 'stage/review.json', output)
    expect(readFileSync(output, 'utf8')).toBe('review-path=stage/review.json\n')
    expect(() => writeStagedOutput('bad\nname', 'value', output)).toThrow(ReviewPayloadError)
    expect(() => writeStagedOutput('bad name', 'value', output)).toThrow(ReviewPayloadError)
    expect(() => writeStagedOutput('name', 'line\nnext', output)).toThrow(ReviewPayloadError)
    expect(() => writeStagedOutput('name', 'line\rnext', output)).toThrow(ReviewPayloadError)
  })

  it('requires GITHUB_OUTPUT when no output path is supplied', () => {
    expect(() => writeStagedOutput('review', 'value', '')).toThrow(ReviewPayloadError)
  })
})
